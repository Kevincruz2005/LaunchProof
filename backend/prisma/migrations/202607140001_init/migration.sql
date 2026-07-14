CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "label" TEXT,
    "passportStatus" TEXT,
    "gates" JSONB,
    "evidence" JSONB,
    "record" JSONB,
    "canonicalEvidenceJcs" TEXT,
    "evidenceHash" TEXT,
    "manifestHash" TEXT,
    "inputHash" TEXT,
    "normalizedResultHash" TEXT,
    "sourceRevision" TEXT,
    "buildCommit" TEXT,
    "previousRunId" TEXT,
    "provider" TEXT,
    "signatureState" TEXT,
    "evidenceTransaction" TEXT,
    "evidenceBlock" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invocation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "expected" JSONB,
    "comparisons" JSONB NOT NULL,
    "classification" TEXT,
    "latencyMs" INTEGER NOT NULL,
    CONSTRAINT "Invocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payer" TEXT,
    "recipient" TEXT,
    "amount" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "settlementTransaction" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Provider" (
    "address" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "signature" TEXT,
    "verificationResult" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Provider_pkey" PRIMARY KEY ("address")
);

CREATE TABLE "Fixture" (
    "variant" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "declarationAddress" TEXT NOT NULL,
    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("variant")
);

CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "publicUrl" TEXT,
    "evidence" JSONB NOT NULL,
    "consented" BOOLEAN NOT NULL,
    CONSTRAINT "CampaignLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Run_idempotencyKey_key" ON "Run"("idempotencyKey");
CREATE UNIQUE INDEX "Invocation_runId_kind_sequence_key" ON "Invocation"("runId", "kind", "sequence");

ALTER TABLE "Invocation"
    ADD CONSTRAINT "Invocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
