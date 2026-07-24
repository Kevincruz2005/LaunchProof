-- The session-scoped advisory lock provides mutual exclusion. This durable,
-- monotonic epoch makes each acquisition observable and fences stale process
-- capabilities in application code and operational logs.
CREATE TABLE "WriterLeadership" (
  "id" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL,
  "holderId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WriterLeadership_pkey" PRIMARY KEY ("id")
);
