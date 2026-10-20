-- Preview billing now uses the existing profiles, spend_events and credit RPCs.
DROP FUNCTION IF EXISTS public.get_my_sandbox_balance();
DROP FUNCTION IF EXISTS public.spend_sandbox_credits(numeric, text, uuid, jsonb);
DROP TABLE IF EXISTS public.stripe_sandbox_spend_events;
DROP TABLE IF EXISTS public.stripe_sandbox_profiles;
