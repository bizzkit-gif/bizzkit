-- If RLS is already enabled on public.businesses, allow authenticated users to read rows
-- (feed, chat peer names, connection cards). Skips when RLS is off so we do not lock the table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'businesses'
      AND c.relrowsecurity = true
  ) THEN
    DROP POLICY IF EXISTS "businesses_select_authenticated" ON public.businesses;
    CREATE POLICY "businesses_select_authenticated"
      ON public.businesses
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
