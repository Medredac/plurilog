-- Match get_my_balance: overdue subscriptions cannot receive a new monthly allowance.
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
    and profiles.plan_status in ('active', 'canceling')
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
