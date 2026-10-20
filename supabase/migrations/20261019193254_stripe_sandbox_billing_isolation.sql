-- Separate sandbox billing rows; no changes to live profiles or billing functions.
CREATE TABLE public.stripe_sandbox_profiles (LIKE public.profiles INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
ALTER TABLE public.stripe_sandbox_profiles ALTER COLUMN credits_cents SET DEFAULT 0;
ALTER TABLE public.stripe_sandbox_profiles ALTER COLUMN remaining_cents SET DEFAULT 0;
ALTER TABLE public.stripe_sandbox_profiles ADD CONSTRAINT sandbox_user_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.stripe_sandbox_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_sandbox_profiles FROM anon, authenticated;
GRANT SELECT ON public.stripe_sandbox_profiles TO authenticated;
GRANT ALL ON public.stripe_sandbox_profiles TO service_role;
CREATE POLICY sandbox_own_billing ON public.stripe_sandbox_profiles FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
CREATE TABLE public.stripe_sandbox_spend_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 discussion_id uuid, model text, cents numeric NOT NULL, meta jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_sandbox_spend_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_sandbox_spend_events FROM anon, authenticated;
GRANT ALL ON public.stripe_sandbox_spend_events TO service_role;
CREATE OR REPLACE FUNCTION public.get_my_sandbox_balance()
 RETURNS TABLE(remaining_cents numeric, credits_cents numeric, plan text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.stripe_sandbox_profiles
  set average_monthly_usage_cents =
        (
          (stripe_sandbox_profiles.average_monthly_usage_cents * stripe_sandbox_profiles.completed_paid_cycles)
          + stripe_sandbox_profiles.total_spent_cents
        ) / (stripe_sandbox_profiles.completed_paid_cycles + 1),
      completed_paid_cycles = stripe_sandbox_profiles.completed_paid_cycles + 1,
      remaining_cents = stripe_sandbox_profiles.credits_cents,
      total_spent_cents = 0,
      period_reset_at = now() + interval '1 month',
      updated_at = now()
  where id = v_uid
    and stripe_sandbox_profiles.plan = 'paid'
    and stripe_sandbox_profiles.plan_status in ('active', 'canceling')
    and stripe_sandbox_profiles.period_reset_at is not null
    and stripe_sandbox_profiles.period_reset_at <= now();

  update public.stripe_sandbox_profiles
  set remaining_cents =
        stripe_sandbox_profiles.remaining_cents
        + (ceil((100 - stripe_sandbox_profiles.remaining_cents) / 100.0) * 100),
      updated_at = now()
  where id = v_uid
    and stripe_sandbox_profiles.plan IN ('paid','weekly_paid')
    and stripe_sandbox_profiles.plan_status in ('active', 'canceling')
    and (stripe_sandbox_profiles.plan = 'paid' OR stripe_sandbox_profiles.current_period_end IS NULL OR stripe_sandbox_profiles.current_period_end > now())
    and stripe_sandbox_profiles.remaining_cents < 100;

  update public.stripe_sandbox_profiles set remaining_cents = 0, updated_at = now()
  where id = v_uid and stripe_sandbox_profiles.plan = 'weekly_paid'
    and (stripe_sandbox_profiles.plan_status = 'canceled' OR stripe_sandbox_profiles.current_period_end <= now());

  return query
    select p.remaining_cents, p.credits_cents, p.plan
    from public.stripe_sandbox_profiles p
    where p.id = v_uid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.spend_sandbox_credits(p_cents numeric, p_model text DEFAULT NULL::text, p_discussion_id uuid DEFAULT NULL::uuid, p_meta jsonb DEFAULT NULL::jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_remaining numeric(10,4);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_cents IS NULL OR p_cents <= 0 OR p_cents::text = 'NaN' THEN
    RAISE EXCEPTION 'Invalid credit spend amount'
      USING ERRCODE = '22023';
  END IF;

  update public.stripe_sandbox_profiles
  set average_monthly_usage_cents =
        (
          (stripe_sandbox_profiles.average_monthly_usage_cents * stripe_sandbox_profiles.completed_paid_cycles)
          + stripe_sandbox_profiles.total_spent_cents
        ) / (stripe_sandbox_profiles.completed_paid_cycles + 1),
      completed_paid_cycles = stripe_sandbox_profiles.completed_paid_cycles + 1,
      remaining_cents = stripe_sandbox_profiles.credits_cents,
      total_spent_cents = 0,
      period_reset_at = now() + interval '1 month',
      updated_at = now()
  where id = v_uid
    and stripe_sandbox_profiles.plan = 'paid'
    and stripe_sandbox_profiles.period_reset_at is not null
    and stripe_sandbox_profiles.period_reset_at <= now();

  update public.stripe_sandbox_profiles
  set remaining_cents = stripe_sandbox_profiles.remaining_cents - p_cents,
      total_spent_cents = stripe_sandbox_profiles.total_spent_cents + p_cents,
      lifetime_usage_cents =
        case
          when stripe_sandbox_profiles.plan IN ('paid','weekly_paid')
            then stripe_sandbox_profiles.lifetime_usage_cents + p_cents
          else stripe_sandbox_profiles.lifetime_usage_cents
        end,
      updated_at = now()
  where id = v_uid;

  update public.stripe_sandbox_profiles
  set remaining_cents =
        stripe_sandbox_profiles.remaining_cents
        + (ceil((100 - stripe_sandbox_profiles.remaining_cents) / 100.0) * 100),
      updated_at = now()
  where id = v_uid
    and stripe_sandbox_profiles.plan IN ('paid','weekly_paid')
    and stripe_sandbox_profiles.plan_status in ('active', 'canceling')
    and (stripe_sandbox_profiles.plan = 'paid' OR stripe_sandbox_profiles.current_period_end IS NULL OR stripe_sandbox_profiles.current_period_end > now())
    and stripe_sandbox_profiles.remaining_cents < 100
  returning stripe_sandbox_profiles.remaining_cents into v_remaining;

  if v_remaining is null then
    select remaining_cents
    into v_remaining
    from public.stripe_sandbox_profiles
    where id = v_uid;
  end if;

  insert into public.stripe_sandbox_spend_events (user_id, discussion_id, model, cents, meta)
  values (v_uid, p_discussion_id, p_model, p_cents, p_meta);

  return v_remaining;
END;
$function$
;

REVOKE ALL ON FUNCTION public.get_my_sandbox_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sandbox_balance() TO authenticated;
REVOKE ALL ON FUNCTION public.spend_sandbox_credits(numeric,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_sandbox_credits(numeric,text,uuid,jsonb) TO authenticated;
