-- Paid-entry launch: only future profile inserts start at zero.
-- handle_new_user inserts id/registration_tracked_at and uses these defaults.
-- No existing balances, plan labels, Stripe IDs or discounts are modified.
alter table public.profiles
  alter column credits_cents set default 0,
  alter column remaining_cents set default 0;
