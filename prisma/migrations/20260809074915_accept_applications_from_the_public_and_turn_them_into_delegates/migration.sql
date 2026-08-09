-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('GOOGLE_SHEETS');

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "schoolName" TEXT,
    "grade" TEXT,
    "committeePreference" TEXT,
    "committeePreference2" TEXT,
    "munsAttended" INTEGER,
    "awardsWon" INTEGER,
    "paymentProofUrl" TEXT,
    "dietaryNotes" TEXT,
    "accessibilityNotes" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "rejectionReason" TEXT,
    "submittedIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegate" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "schoolName" TEXT,
    "grade" TEXT,
    "registrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delegate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceIntegration" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "secretHash" TEXT NOT NULL,
    "headerMap" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Registration_conferenceId_status_idx" ON "Registration"("conferenceId", "status");

-- CreateIndex
CREATE INDEX "Registration_conferenceId_email_idx" ON "Registration"("conferenceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_conferenceId_reference_key" ON "Registration"("conferenceId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Delegate_registrationId_key" ON "Delegate"("registrationId");

-- CreateIndex
CREATE INDEX "Delegate_conferenceId_idx" ON "Delegate"("conferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Delegate_conferenceId_email_key" ON "Delegate"("conferenceId", "email");

-- CreateIndex
CREATE INDEX "ConferenceIntegration_conferenceId_idx" ON "ConferenceIntegration"("conferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceIntegration_conferenceId_kind_key" ON "ConferenceIntegration"("conferenceId", "kind");

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegate" ADD CONSTRAINT "Delegate_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegate" ADD CONSTRAINT "Delegate_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceIntegration" ADD CONSTRAINT "ConferenceIntegration_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every migration that adds a table repeats this. Idempotent; the RLS test
-- fails until it is here.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;
END $$;
