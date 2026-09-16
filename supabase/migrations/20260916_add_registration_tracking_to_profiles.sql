-- Migration: 20260916_add_registration_tracking_to_profiles.sql
-- Description: Add deterministic registration tracking marker to public.profiles

-- 1. Add nullable column to public.profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS registration_tracked_at timestamptz;

-- 2. Backfill ALL existing profiles so no existing user can ever be mistaken for a new registration later
UPDATE public.profiles
SET registration_tracked_at = COALESCE(created_at, NOW())
WHERE registration_tracked_at IS NULL;

-- 3. Replace public.handle_new_user() function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
  v_registered_at timestamptz;
BEGIN
  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');

  IF v_provider = 'email' THEN
    v_registered_at := NOW();
  ELSE
    v_registered_at := NULL;
  END IF;

  INSERT INTO public.profiles (id, registration_tracked_at)
  VALUES (NEW.id, v_registered_at);

  RETURN NEW;
END;
$$;

-- 4. Create atomic RPC to claim new registration
CREATE OR REPLACE FUNCTION public.claim_new_registration()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
  SET registration_tracked_at = NOW()
  WHERE id = auth.uid()
    AND registration_tracked_at IS NULL
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

-- 5. Permissions
REVOKE ALL ON FUNCTION public.claim_new_registration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_new_registration() TO authenticated;
