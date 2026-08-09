-- Deny PostgREST access to every application table.
--
-- This is not defence in depth. Supabase exposes PostgREST over every table in
-- `public` to anyone holding the publishable anon key, and that key ships in
-- the browser bundle. Without this migration, the entire delegate table is
-- readable by anyone who opens devtools.
--
-- Row level security is enabled with *no policies at all*, which denies
-- everything to every role that does not bypass RLS. The application is
-- unaffected: the role Prisma connects as has BYPASSRLS, which is asserted by a
-- test rather than assumed.
--
-- RLS is deliberately not the tenancy mechanism. Under a transaction-mode
-- pooler `SET LOCAL app.current_conference` only holds inside an explicit
-- transaction, so every query would need wrapping in one, plus a non-BYPASSRLS
-- role and a policy on every table in every migration. Tenancy is enforced in
-- src/server/db.ts instead.
--
-- Every future migration that adds a table must repeat the first block. It is
-- idempotent, so copying it wholesale is fine. `tests/security.rls.test.ts`
-- fails until a new table is covered.

-- 1. Enable RLS on every table in the public schema.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;
END $$;

-- 2. Revoke the grants Supabase hands to the two roles reachable from a
--    browser. Guarded, because these roles do not exist on a local Postgres and
--    this migration has to run in both places.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE USAGE ON SCHEMA public FROM anon;

    -- Without this, a table created by a later migration is granted to anon
    -- again by Supabase's default privileges, and the revoke above protects
    -- only the tables that existed on the day it ran.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE USAGE ON SCHEMA public FROM authenticated;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END $$;
