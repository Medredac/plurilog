-- Add weekly Plus without changing the existing monthly reset/refill branches.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_plan_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free','paid','weekly_paid'));

CREATE OR REPLACE FUNCTION public.factory_results_snapshot(p_since timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
 SET statement_timeout TO '5s'
AS $function$
DECLARE result jsonb;
BEGIN
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Restricted results feed' USING ERRCODE='42501'; END IF;
 IF p_since IS NULL OR p_since > now() OR p_since < now()-interval '366 days' THEN
  RAISE EXCEPTION 'Cohort start must be within the last 366 days' USING ERRCODE='22023';
 END IF;
 WITH facts AS (
  SELECT CASE WHEN lower(trim(coalesce(signup_source,''))) IN
   ('plurilog_outreach','fb','ig','google','google_ads','direct','referral','reddit','bing','an','resend','chatgpt','gemini','claude','linkedin','twitter')
   THEN lower(trim(signup_source)) WHEN coalesce(trim(signup_source),'')='' THEN 'unknown' ELSE 'other' END AS source,
   created_at,
   (plan IN ('paid','weekly_paid') AND stripe_subscription_id IS NOT NULL AND plan_status IN ('active','canceling') AND current_period_end>now()) IS TRUE AS paid_active,
   plan_status,
   (coalesce(lifetime_usage_cents,0)>0 OR coalesce(total_spent_cents,0)>0) AS used_credits
  FROM public.profiles
 ), grouped AS (
  SELECT source,count(*) AS signups,
   count(*) FILTER(WHERE created_at>=now()-interval '7 days') AS signups_7d,
   count(*) FILTER(WHERE created_at>=now()-interval '30 days') AS signups_30d,
   count(*) FILTER(WHERE paid_active) AS paid_active,
   count(*) FILTER(WHERE paid_active AND plan_status='canceling') AS canceling,
   count(*) FILTER(WHERE plan_status='past_due') AS past_due,
   count(*) FILTER(WHERE plan_status='canceled') AS canceled,
   count(*) FILTER(WHERE used_credits) AS used_credits,
   count(*) FILTER(WHERE created_at>=p_since) AS cohort_signups,
   count(*) FILTER(WHERE created_at>=p_since AND paid_active) AS cohort_paid_active,
   count(*) FILTER(WHERE created_at>=p_since AND used_credits) AS cohort_used_credits
  FROM facts GROUP BY source
 )
 SELECT jsonb_build_object('version',1,'generatedAt',now(),'cohortStart',p_since,
  'sources',coalesce(jsonb_agg(jsonb_build_object('source',source,'signups',signups,
   'signups7d',signups_7d,'signups30d',signups_30d,'paidActive',paid_active,
   'canceling',canceling,'pastDue',past_due,'canceled',canceled,'usedCredits',used_credits,
   'cohortSignups',cohort_signups,'cohortPaidActive',cohort_paid_active,'cohortUsedCredits',cohort_used_credits)
   ORDER BY source),'[]'::jsonb)) INTO result FROM grouped;
 RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_balance()
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

  update public.profiles
  set average_monthly_usage_cents =
        (
          (profiles.average_monthly_usage_cents * profiles.completed_paid_cycles)
          + profiles.total_spent_cents
        ) / (profiles.completed_paid_cycles + 1),
      completed_paid_cycles = profiles.completed_paid_cycles + 1,
      remaining_cents = profiles.credits_cents,
      total_spent_cents = 0,
      period_reset_at = now() + interval '1 month',
      updated_at = now()
  where id = v_uid
    and profiles.plan = 'paid'
    and profiles.plan_status in ('active', 'canceling')
    and profiles.period_reset_at is not null
    and profiles.period_reset_at <= now();

  update public.profiles
  set remaining_cents =
        profiles.remaining_cents
        + (ceil((100 - profiles.remaining_cents) / 100.0) * 100),
      updated_at = now()
  where id = v_uid
    and profiles.plan IN ('paid','weekly_paid')
    and profiles.plan_status in ('active', 'canceling')
    and (profiles.plan = 'paid' OR profiles.current_period_end IS NULL OR profiles.current_period_end > now())
    and profiles.remaining_cents < 100;

  update public.profiles set remaining_cents = 0, updated_at = now()
  where id = v_uid and profiles.plan = 'weekly_paid'
    and (profiles.plan_status = 'canceled' OR profiles.current_period_end <= now());

  return query
    select p.remaining_cents, p.credits_cents, p.plan
    from public.profiles p
    where p.id = v_uid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.spend_credits(p_cents numeric, p_model text DEFAULT NULL::text, p_discussion_id uuid DEFAULT NULL::uuid, p_meta jsonb DEFAULT NULL::jsonb)
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

  update public.profiles
  set average_monthly_usage_cents =
        (
          (profiles.average_monthly_usage_cents * profiles.completed_paid_cycles)
          + profiles.total_spent_cents
        ) / (profiles.completed_paid_cycles + 1),
      completed_paid_cycles = profiles.completed_paid_cycles + 1,
      remaining_cents = profiles.credits_cents,
      total_spent_cents = 0,
      period_reset_at = now() + interval '1 month',
      updated_at = now()
  where id = v_uid
    and profiles.plan = 'paid'
    and profiles.period_reset_at is not null
    and profiles.period_reset_at <= now();

  update public.profiles
  set remaining_cents = profiles.remaining_cents - p_cents,
      total_spent_cents = profiles.total_spent_cents + p_cents,
      lifetime_usage_cents =
        case
          when profiles.plan IN ('paid','weekly_paid')
            then profiles.lifetime_usage_cents + p_cents
          else profiles.lifetime_usage_cents
        end,
      updated_at = now()
  where id = v_uid;

  update public.profiles
  set remaining_cents =
        profiles.remaining_cents
        + (ceil((100 - profiles.remaining_cents) / 100.0) * 100),
      updated_at = now()
  where id = v_uid
    and profiles.plan IN ('paid','weekly_paid')
    and profiles.plan_status in ('active', 'canceling')
    and (profiles.plan = 'paid' OR profiles.current_period_end IS NULL OR profiles.current_period_end > now())
    and profiles.remaining_cents < 100
  returning profiles.remaining_cents into v_remaining;

  if v_remaining is null then
    select remaining_cents
    into v_remaining
    from public.profiles
    where id = v_uid;
  end if;

  insert into public.spend_events (user_id, discussion_id, model, cents, meta)
  values (v_uid, p_discussion_id, p_model, p_cents, p_meta);

  return v_remaining;
END;
$function$
;
