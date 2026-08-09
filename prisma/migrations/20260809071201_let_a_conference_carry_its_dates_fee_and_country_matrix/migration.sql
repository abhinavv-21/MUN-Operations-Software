-- AlterTable
ALTER TABLE "Conference" ADD COLUMN     "endsOn" TIMESTAMP(3),
ADD COLUMN     "feeCurrency" VARCHAR(3),
ADD COLUMN     "feeMinorUnits" INTEGER,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "registrationDeadline" TIMESTAMP(3),
ADD COLUMN     "startsOn" TIMESTAMP(3),
ADD COLUMN     "venue" TEXT;

-- CreateTable
CREATE TABLE "CommitteeCountry" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeCountry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeCountry_conferenceId_idx" ON "CommitteeCountry"("conferenceId");

-- CreateIndex
CREATE INDEX "CommitteeCountry_committeeId_idx" ON "CommitteeCountry"("committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeCountry_conferenceId_committeeId_country_key" ON "CommitteeCountry"("conferenceId", "committeeId", "country");

-- AddForeignKey
ALTER TABLE "CommitteeCountry" ADD CONSTRAINT "CommitteeCountry_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeCountry" ADD CONSTRAINT "CommitteeCountry_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every migration that adds a table repeats this. A new table arrives with row
-- level security off, which is wide open to PostgREST rather than closed.
-- Idempotent, so it is safe to copy wholesale. tests/security.rls.test.ts fails
-- until it is here.
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
