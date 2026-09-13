ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS signup_source text;

CREATE OR REPLACE FUNCTION public.set_my_signup_source(p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR p_source IS NULL
     OR length(trim(p_source)) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET signup_source = substring(trim(p_source) from 1 for 50)
  WHERE id = auth.uid()
    AND signup_source IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_signup_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_signup_source(text) TO authenticated;
