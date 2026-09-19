-- Migration: 20260919_add_country_code_to_profiles.sql
-- Description: Add nullable country_code column to public.profiles and atomic one-time setter RPC

-- 1. Add nullable column to public.profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS country_code text;

-- 2. Add CHECK constraint for valid ISO 3166-1 alpha-2 uppercase codes
ALTER TABLE public.profiles
ADD CONSTRAINT chk_profiles_country_code
CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- 3. Create atomic SECURITY DEFINER RPC to set country code once
CREATE OR REPLACE FUNCTION public.set_my_country_code(p_country text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
BEGIN
  IF auth.uid() IS NULL OR p_country IS NULL THEN
    RETURN;
  END IF;

  v_normalized := upper(trim(p_country));

  IF v_normalized !~ '^[A-Z]{2}$' THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET country_code = v_normalized
  WHERE id = auth.uid()
    AND country_code IS NULL;
END;
$$;

-- 4. Permissions
REVOKE ALL ON FUNCTION public.set_my_country_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_country_code(text) TO authenticated;
