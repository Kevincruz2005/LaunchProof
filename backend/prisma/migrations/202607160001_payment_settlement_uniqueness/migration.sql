-- A settlement transaction is a one-time proof and cannot authorize multiple payments.
CREATE UNIQUE INDEX "Payment_settlementTransaction_key" ON "Payment"("settlementTransaction");

ALTER TABLE "Payment"
  ADD COLUMN "amountDisplay" TEXT NOT NULL DEFAULT '0',
  ADD COLUMN "assetDecimals" INTEGER NOT NULL DEFAULT 6;

-- Normalize legacy rows: LaunchProof receipts stored decimal units, while target
-- receipts stored atomic units. New rows use atomic `amount` consistently.
UPDATE "Payment"
SET
  "amountDisplay" = CASE
    WHEN "kind" = 'launchproof' THEN "amount"
    ELSE TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM (("amount"::numeric / 1000000)::text)))
  END,
  "amount" = CASE
    WHEN "kind" = 'launchproof' THEN (("amount"::numeric * 1000000)::bigint)::text
    ELSE "amount"
  END;

CREATE TABLE "ChainCursor" (
  "id" TEXT NOT NULL,
  "block" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChainCursor_pkey" PRIMARY KEY ("id")
);
