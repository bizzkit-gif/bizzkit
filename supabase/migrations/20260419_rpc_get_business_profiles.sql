-- Peer names / connection cards: bypass RLS for id-targeted reads (RLS often blocks .in() while full scans work).
-- Run via `supabase db push` or SQL editor after deploy.

CREATE OR REPLACE FUNCTION public.get_business_profiles_by_ids(p_ids uuid[])
RETURNS SETOF public.businesses
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM public.businesses WHERE id = ANY(p_ids);
$$;

REVOKE ALL ON FUNCTION public.get_business_profiles_by_ids(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_business_profiles_by_ids(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_profiles_by_ids(uuid[]) TO anon;
