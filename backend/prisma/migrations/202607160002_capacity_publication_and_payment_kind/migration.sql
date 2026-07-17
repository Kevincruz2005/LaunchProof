ALTER TABLE "Run"
  ADD COLUMN "capacityLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "publicationTransaction" TEXT,
  ADD COLUMN "publicationEvidenceHash" TEXT,
  ADD COLUMN "publicationStartedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_runId_kind_key" ON "Payment"("runId", "kind");
