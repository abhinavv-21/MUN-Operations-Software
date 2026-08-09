-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_delegateId_key" ON "Assignment"("delegateId");

-- CreateIndex
CREATE INDEX "Assignment_conferenceId_idx" ON "Assignment"("conferenceId");

-- CreateIndex
CREATE INDEX "Assignment_committeeId_idx" ON "Assignment"("committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_conferenceId_committeeId_country_key" ON "Assignment"("conferenceId", "committeeId", "country");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "Delegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every migration that adds a table repeats this. Idempotent.
DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.tablename); END LOOP;
END $$;
