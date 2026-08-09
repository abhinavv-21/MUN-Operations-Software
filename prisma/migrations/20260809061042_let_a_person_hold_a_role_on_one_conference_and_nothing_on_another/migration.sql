-- CreateEnum
CREATE TYPE "ConferenceRoleName" AS ENUM ('ADMIN', 'CONTRIBUTOR');

-- CreateTable
CREATE TABLE "ConferenceRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "role" "ConferenceRoleName" NOT NULL DEFAULT 'CONTRIBUTOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConferenceRole_conferenceId_idx" ON "ConferenceRole"("conferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceRole_userId_conferenceId_key" ON "ConferenceRole"("userId", "conferenceId");

-- AddForeignKey
ALTER TABLE "ConferenceRole" ADD CONSTRAINT "ConferenceRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceRole" ADD CONSTRAINT "ConferenceRole_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every migration that adds a table repeats this. A new table arrives with row
-- level security off, which is wide open to PostgREST rather than closed, and
-- Postgres will not turn it on for us: an event trigger on CREATE TABLE needs a
-- superuser and the role we migrate as is not one. Idempotent, so it is safe to
-- copy wholesale. tests/security.rls.test.ts fails until it is here.
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
