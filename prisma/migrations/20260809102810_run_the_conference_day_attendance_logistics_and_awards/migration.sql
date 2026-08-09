-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');

-- CreateEnum
CREATE TYPE "LogisticsCategory" AS ENUM ('EQUIPMENT', 'STATIONERY', 'REFRESHMENT', 'TECHNICAL', 'MEDICAL', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LogisticsStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogisticsPriority" AS ENUM ('LOW', 'NORMAL', 'URGENT');

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "markedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsRequest" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "committeeId" TEXT,
    "category" "LogisticsCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "LogisticsPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "LogisticsStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "requestedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolution" TEXT,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rank" INTEGER,
    "note" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awardedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceRecord_conferenceId_day_idx" ON "AttendanceRecord"("conferenceId", "day");

-- CreateIndex
CREATE INDEX "AttendanceRecord_delegateId_idx" ON "AttendanceRecord"("delegateId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_conferenceId_delegateId_day_key" ON "AttendanceRecord"("conferenceId", "delegateId", "day");

-- CreateIndex
CREATE INDEX "LogisticsRequest_conferenceId_status_idx" ON "LogisticsRequest"("conferenceId", "status");

-- CreateIndex
CREATE INDEX "LogisticsRequest_committeeId_idx" ON "LogisticsRequest"("committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsRequest_conferenceId_clientRequestId_key" ON "LogisticsRequest"("conferenceId", "clientRequestId");

-- CreateIndex
CREATE INDEX "Award_conferenceId_idx" ON "Award"("conferenceId");

-- CreateIndex
CREATE INDEX "Award_committeeId_idx" ON "Award"("committeeId");

-- CreateIndex
CREATE INDEX "Award_delegateId_idx" ON "Award"("delegateId");

-- CreateIndex
CREATE UNIQUE INDEX "Award_conferenceId_committeeId_delegateId_title_key" ON "Award"("conferenceId", "committeeId", "delegateId", "title");

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "Delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsRequest" ADD CONSTRAINT "LogisticsRequest_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsRequest" ADD CONSTRAINT "LogisticsRequest_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsRequest" ADD CONSTRAINT "LogisticsRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsRequest" ADD CONSTRAINT "LogisticsRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "Delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_awardedByUserId_fkey" FOREIGN KEY ("awardedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every migration that adds a table repeats this. Idempotent.
--
-- Supabase serves PostgREST over `public` to anyone holding the publishable
-- anon key, and a new table arrives with row level security off. Three tables
-- land here, two of which carry delegate names — see docs/02-INVARIANTS.md #7.
DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.tablename); END LOOP;
END $$;
