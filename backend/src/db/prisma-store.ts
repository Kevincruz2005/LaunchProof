import { Prisma, PrismaClient } from "@prisma/client";
import type { PaymentReference, RunRecord, RunState } from "../domain/types.js";
import {
  RunCapacityError,
  type PublicationProgress,
  type Repository,
  type RunCapacity,
  type RunProgress,
  type SettlementProgress,
  type StoredRun,
  type TargetPaymentAttempt,
} from "./store.js";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaRepository implements Repository {
  constructor(private readonly client = new PrismaClient({
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  })) {}

  async createProgress(progress: RunProgress): Promise<StoredRun> {
    return this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      const existing = await transaction.run.findUnique({
        where: { idempotencyKey: progress.idempotency_key },
        select: { record: true },
      });
      if (existing) return existing.record as unknown as StoredRun;
      const row = await transaction.run.create({
        data: {
          id: progress.run_id,
          idempotencyKey: progress.idempotency_key,
          state: progress.state,
          target: progress.target,
          error: progress.error,
          record: json(progress),
        },
        select: { record: true },
      });
      return row.record as unknown as StoredRun;
    });
  }

  async updateState(runId: string, state: RunState, error: string | undefined = undefined): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952003)::text AS lock_result`;
      const current = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!current) throw new Error("Cannot update a missing run");
      const progress = current.record as unknown as StoredRun;
      if (isRunRecord(progress) || !canAdvance(progress.state, state)) return;
      await transaction.run.update({
        where: { id: runId },
        data: {
          state,
          ...(error ? { error: error.slice(0, 500) } : {}),
          record: json({ ...progress, state, updated_at: new Date().toISOString(), error: error ?? progress.error ?? null }),
        },
      });
    });
  }

  async saveRun(run: RunRecord): Promise<void> {
    const invocations = [
      run.canonical_evidence.fixed_sample,
      run.canonical_evidence.invalid_input,
      ...run.canonical_evidence.challenges,
    ];
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952003)::text AS lock_result`;
      const existing = await transaction.run.findUnique({ where: { id: run.run_id }, select: { record: true } });
      if (!existing) throw new Error("Cannot finalize a missing run reservation");
      const current = existing.record as unknown as StoredRun;
      if (isRunRecord(current)) {
        if (current.canonical_evidence_jcs !== run.canonical_evidence_jcs) {
          throw new Error("Finalized run cannot be overwritten with different evidence");
        }
        return;
      }
      await transaction.run.update({
        where: { id: run.run_id },
        data: {
          state: run.state,
          label: run.label,
          passportStatus: run.passport_status,
          gates: json(run.gates),
          evidence: json(run.canonical_evidence),
          record: json(run),
          canonicalEvidenceJcs: run.canonical_evidence_jcs,
          evidenceHash: run.evidence_hash,
          manifestHash: run.manifest_hash,
          inputHash: run.input_hash,
          normalizedResultHash: run.normalized_result_hash,
          sourceRevision: run.source_version_sha,
          buildCommit: run.build_commit_sha,
          previousRunId: run.previous_run_id,
          provider: run.provider_declaration.provider_address,
          signatureState: run.provider_declaration.verification_state,
          evidenceTransaction: run.chain.evidence_transaction_hash,
          evidenceBlock: run.chain.block_number,
          error: null,
        },
      });
      await transaction.invocation.deleteMany({ where: { runId: run.run_id } });
      await transaction.invocation.createMany({
        data: invocations.map((invocation) => ({
          runId: run.run_id,
          kind: invocation.kind,
          sequence: invocation.index,
          input: json(invocation.input),
          output: invocation.output ? json(invocation.output) : Prisma.JsonNull,
          expected: invocation.expected ? json(invocation.expected) : Prisma.JsonNull,
          comparisons: json(invocation.comparisons),
          classification: invocation.classification,
          latencyMs: invocation.latency_ms,
        })),
      });
      await transaction.provider.upsert({
        where: { address: run.provider_declaration.provider_address },
        create: {
          address: run.provider_declaration.provider_address,
          manifestHash: run.manifest_hash,
          signature: run.canonical_evidence.provider_declaration.signature,
          verificationResult: run.provider_declaration.verification_state,
        },
        update: {
          manifestHash: run.manifest_hash,
          signature: run.canonical_evidence.provider_declaration.signature,
          verificationResult: run.provider_declaration.verification_state,
        },
      });
    });
  }

  async getRun(runId: string): Promise<StoredRun | null> {
    const row = await this.client.run.findUnique({ where: { id: runId }, select: { record: true } });
    return (row?.record as unknown as StoredRun | null) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<StoredRun | null> {
    const row = await this.client.run.findUnique({ where: { idempotencyKey: key }, select: { record: true } });
    return (row?.record as unknown as StoredRun | null) ?? null;
  }

  async recentRuns(limit: number): Promise<RunRecord[]> {
    const rows = await this.client.run.findMany({
      where: { passportStatus: { not: null }, record: { not: Prisma.JsonNull } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { record: true },
    });
    return rows.map((row) => row.record as unknown as RunRecord);
  }

  async savePayment(payment: PaymentReference, runId: string): Promise<void> {
    const existing = await this.client.payment.findUnique({ where: { id: payment.payment_id } });
    if (existing && !samePersistedPayment(existing, payment, runId)) {
      throw new Error("Payment ID is already bound to a different run or settlement");
    }
    if (payment.settlement_transaction) {
      const transactionOwner = await this.client.payment.findUnique({
        where: { settlementTransaction: payment.settlement_transaction },
        select: { id: true },
      });
      if (transactionOwner && transactionOwner.id !== payment.payment_id) {
        throw new Error("Settlement transaction is already bound to another payment");
      }
    }
    const kindOwner = await this.client.payment.findFirst({
      where: { runId, kind: payment.kind },
      select: { id: true },
    });
    if (kindOwner && kindOwner.id !== payment.payment_id) {
      throw new Error("Run already has a different payment for this kind");
    }
    await this.client.payment.upsert({
      where: { id: payment.payment_id },
      create: {
        id: payment.payment_id,
        runId,
        kind: payment.kind,
        payer: payment.payer,
        recipient: payment.recipient,
        amount: payment.amount,
        amountDisplay: payment.amount_display,
        assetDecimals: payment.asset_decimals,
        asset: payment.asset,
        network: payment.network,
        route: payment.route,
        settlementTransaction: payment.settlement_transaction,
        status: payment.status,
        createdAt: new Date(payment.timestamp),
      },
      update: {},
    });
  }

  async authorizeRun(payment: PaymentReference, runId: string, capacity?: RunCapacity): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      const observedAt = new Date();
      await expireCapacityClaims(transaction, observedAt);
      const run = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!run) throw new Error("Cannot authorize a missing run reservation");
      const progress = run.record as unknown as StoredRun;
      if (isRunRecord(progress)) {
        if (!samePaymentReference(progress.payment, payment)) throw new Error("Run authorization payment is immutable");
      } else if (progress.payment) {
        if (!samePaymentReference(progress.payment, payment)) throw new Error("Run authorization payment is immutable");
      } else if (payment.status === "settled") {
        if (progress.state !== "settlement_claimed" &&
          !(progress.state === "payment_ambiguous" && settlementMatchesPayment(progress.settlement, payment))) {
          throw new Error("Settled payment has no durable pre-settlement capacity claim");
        }
      } else if (capacity) {
        const count = await countCapacity(transaction, capacity.since);
        if (count >= capacity.limit) throw new RunCapacityError("Global daily rehearsal capacity has been reached");
      }
      const existing = await transaction.payment.findUnique({ where: { id: payment.payment_id } });
      if (existing && !samePersistedPayment(existing, payment, runId)) {
        throw new Error("Payment ID is already bound to a different run or settlement");
      }
      if (payment.settlement_transaction) {
        const transactionOwner = await transaction.payment.findUnique({
          where: { settlementTransaction: payment.settlement_transaction },
          select: { id: true },
        });
        if (transactionOwner && transactionOwner.id !== payment.payment_id) {
          throw new Error("Settlement transaction is already bound to another payment");
        }
      }
      const kindOwner = await transaction.payment.findFirst({
        where: { runId, kind: payment.kind },
        select: { id: true },
      });
      if (kindOwner && kindOwner.id !== payment.payment_id) {
        throw new Error("Run already has a different payment for this kind");
      }
      await transaction.payment.upsert({
        where: { id: payment.payment_id },
        create: {
          id: payment.payment_id,
          runId,
          kind: payment.kind,
          payer: payment.payer,
          recipient: payment.recipient,
          amount: payment.amount,
          amountDisplay: payment.amount_display,
          assetDecimals: payment.asset_decimals,
          asset: payment.asset,
          network: payment.network,
          route: payment.route,
          settlementTransaction: payment.settlement_transaction,
          status: payment.status,
          createdAt: new Date(payment.timestamp),
        },
        update: {},
      });
      if (isRunRecord(progress) || progress.payment) return;
      const authorized: RunProgress = {
        ...progress,
        payment,
        state: "payment_settled",
        capacity_lease_expires_at: null,
        updated_at: new Date().toISOString(),
      };
      await transaction.run.update({
        where: { id: runId },
        data: { state: "payment_settled", capacityLeaseExpiresAt: null, record: json(authorized) },
      });
    });
  }

  async claimRunCapacity(runId: string, capacity: RunCapacity, leaseExpiresAt: string): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      const observedAt = new Date();
      await expireCapacityClaims(transaction, observedAt);
      const run = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!run) throw new Error("Cannot claim capacity for a missing run");
      const progress = run.record as unknown as StoredRun;
      if (isRunRecord(progress) || progress.state !== "payment_required" || progress.payment) {
        throw new Error("Run is not awaiting a payment capacity claim");
      }
      const count = await countCapacity(transaction, capacity.since);
      if (count >= capacity.limit) throw new RunCapacityError("Global daily rehearsal capacity has been reached");
      const claimed: RunProgress = {
        ...progress,
        state: "settlement_claimed",
        capacity_lease_expires_at: leaseExpiresAt,
        updated_at: observedAt.toISOString(),
      };
      await transaction.run.update({
        where: { id: runId },
        data: {
          state: "settlement_claimed",
          capacityLeaseExpiresAt: new Date(leaseExpiresAt),
          record: json(claimed),
        },
      });
    });
  }

  async releaseRunCapacity(runId: string): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      await releaseCapacityClaim(transaction, runId);
    });
  }

  async releaseExpiredRunCapacity(runId: string, observedAt: string): Promise<boolean> {
    return this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      const row = await transaction.run.findUnique({
        where: { id: runId },
        select: { state: true, capacityLeaseExpiresAt: true },
      });
      if (row?.state !== "settlement_claimed" || !row.capacityLeaseExpiresAt || row.capacityLeaseExpiresAt > new Date(observedAt)) {
        return false;
      }
      await releaseCapacityClaim(transaction, runId);
      return true;
    });
  }

  async markPaymentAmbiguous(runId: string, error: string): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!row) return;
      const progress = row.record as unknown as StoredRun;
      if (isRunRecord(progress) ||
        (progress.state !== "settlement_claimed" && progress.state !== "payment_ambiguous")) return;
      const ambiguous: RunProgress = {
        ...progress,
        state: "payment_ambiguous",
        capacity_lease_expires_at: null,
        updated_at: new Date().toISOString(),
        error: error.slice(0, 500),
      };
      await transaction.run.update({
        where: { id: runId },
        data: { state: "payment_ambiguous", capacityLeaseExpiresAt: null, error: ambiguous.error, record: json(ambiguous) },
      });
    });
  }

  async recordPaymentSettlement(runId: string, settlement: SettlementProgress): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!row) throw new Error("Cannot record settlement for a missing run");
      const progress = row.record as unknown as StoredRun;
      if (isRunRecord(progress)) throw new Error("Cannot record settlement for a finalized run");
      if (progress.state === "payment_ambiguous") {
        if (sameSettlement(progress.settlement, settlement)) return;
        if (progress.settlement) throw new Error("Settlement transaction is immutable");
      } else if (progress.state !== "settlement_claimed") {
        throw new Error("Settlement has no durable capacity claim");
      }
      const ambiguous: RunProgress = {
        ...progress,
        state: "payment_ambiguous",
        settlement,
        capacity_lease_expires_at: null,
        updated_at: settlement.observed_at,
      };
      await transaction.run.update({
        where: { id: runId },
        data: { state: "payment_ambiguous", capacityLeaseExpiresAt: null, record: json(ambiguous) },
      });
    });
  }

  async resetPaymentAmbiguous(runId: string): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952002)::text AS lock_result`;
      const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!row) return;
      const progress = row.record as unknown as StoredRun;
      if (isRunRecord(progress) || progress.state !== "payment_ambiguous") return;
      const reset: RunProgress = {
        ...progress,
        state: "payment_required",
        settlement: null,
        capacity_lease_expires_at: null,
        updated_at: new Date().toISOString(),
        error: null,
      };
      await transaction.run.update({
        where: { id: runId },
        data: { state: "payment_required", capacityLeaseExpiresAt: null, error: null, record: json(reset) },
      });
    });
  }

  async pendingPaymentSettlements(): Promise<RunProgress[]> {
    const rows = await this.client.run.findMany({
      where: { state: "payment_ambiguous" },
      select: { record: true },
    });
    return rows
      .map((row) => row.record as unknown as RunProgress)
      .filter((run) => Boolean(run.settlement));
  }

  async recordPublicationAttempt(runId: string, publication: PublicationProgress): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952003)::text AS lock_result`;
      const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!row) throw new Error("Cannot record publication for a missing run");
      const progress = row.record as unknown as StoredRun;
      if (isRunRecord(progress)) return;
      const publishing: RunProgress = {
        ...progress,
        state: "publishing_on_chain",
        publication,
        updated_at: publication.started_at,
      };
      await transaction.run.update({
        where: { id: runId },
        data: {
          state: "publishing_on_chain",
          publicationTransaction: publication.transaction_hash,
          publicationEvidenceHash: publication.evidence_hash,
          publicationStartedAt: new Date(publication.started_at),
          record: json(publishing),
        },
      });
    });
  }

  async pendingPublications(): Promise<RunProgress[]> {
    const rows = await this.client.run.findMany({
      where: { state: "publishing_on_chain", publicationTransaction: { not: null } },
      select: { record: true },
    });
    return rows.map((row) => row.record as unknown as RunProgress).filter((run) => Boolean(run.publication));
  }

  async recordTargetPaymentAttempt(runId: string, attempt: TargetPaymentAttempt): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952004)::text AS lock_result`;
      const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!row) throw new Error("Cannot record target payment for a missing run");
      const progress = row.record as unknown as StoredRun;
      if (isRunRecord(progress)) throw new Error("Cannot record target payment for a finalized run");
      if (progress.target_payment_attempt && JSON.stringify(progress.target_payment_attempt) !== JSON.stringify(attempt)) {
        throw new Error("Target payment authorization is immutable");
      }
      await transaction.run.update({
        where: { id: runId },
        data: { record: json({ ...progress, target_payment_attempt: attempt, updated_at: attempt.created_at }) },
      });
    });
  }

  async recordTargetPaymentTransaction(runId: string, transactionHash: string): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952004)::text AS lock_result`;
      const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!row) throw new Error("Cannot record target settlement for a missing run");
      const progress = row.record as unknown as StoredRun;
      if (isRunRecord(progress) || !progress.target_payment_attempt) {
        throw new Error("Target settlement has no durable signed authorization");
      }
      const existing = progress.target_payment_attempt.transaction_hash;
      if (existing && existing.toLowerCase() !== transactionHash.toLowerCase()) {
        throw new Error("Target settlement transaction is immutable");
      }
      await transaction.run.update({
        where: { id: runId },
        data: { record: json({
          ...progress,
          target_payment_attempt: { ...progress.target_payment_attempt, transaction_hash: transactionHash },
          updated_at: new Date().toISOString(),
        }) },
      });
    });
  }

  async clearTargetPaymentAttempt(runId: string): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952004)::text AS lock_result`;
      const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true } });
      if (!row) return;
      const progress = row.record as unknown as StoredRun;
      if (isRunRecord(progress)) return;
      const reset: RunProgress = {
        ...progress,
        state: "payment_settled",
        target_payment_attempt: null,
        updated_at: new Date().toISOString(),
      };
      await transaction.run.update({ where: { id: runId }, data: { state: reset.state, record: json(reset) } });
    });
  }

  async pendingTargetPaymentAttempts(): Promise<RunProgress[]> {
    const rows = await this.client.run.findMany({
      where: { state: "target_payment_or_not_tested" },
      select: { record: true },
    });
    return rows.map((row) => row.record as unknown as RunProgress).filter((run) => Boolean(run.target_payment_attempt));
  }

  async getPayment(paymentId: string): Promise<(PaymentReference & { run_id: string }) | null> {
    const payment = await this.client.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return null;
    return {
      payment_id: payment.id,
      run_id: payment.runId,
      kind: payment.kind as PaymentReference["kind"],
      payer: payment.payer,
      recipient: payment.recipient,
      amount: payment.amount,
      amount_atomic: payment.amount,
      amount_display: payment.amountDisplay,
      asset_decimals: payment.assetDecimals,
      asset: payment.asset,
      network: payment.network,
      route: payment.route,
      settlement_transaction: payment.settlementTransaction,
      status: payment.status as PaymentReference["status"],
      timestamp: payment.createdAt.toISOString(),
    };
  }

  async getTargetPaymentForRun(runId: string): Promise<PaymentReference | null> {
    const payment = await this.client.payment.findFirst({
      where: { runId, kind: "target", status: "settled" },
      orderBy: { createdAt: "asc" },
    });
    if (!payment) return null;
    return {
      payment_id: payment.id,
      kind: "target",
      payer: payment.payer,
      recipient: payment.recipient,
      amount: payment.amount,
      amount_atomic: payment.amount,
      amount_display: payment.amountDisplay,
      asset_decimals: payment.assetDecimals,
      asset: payment.asset,
      network: payment.network,
      route: payment.route,
      settlement_transaction: payment.settlementTransaction,
      status: payment.status as PaymentReference["status"],
      timestamp: payment.createdAt.toISOString(),
    };
  }

  async targetSpendSince(timestamp: string): Promise<bigint> {
    const rows = await this.client.payment.findMany({
      where: { kind: "target", status: "settled", createdAt: { gte: new Date(timestamp) } },
      select: { amount: true },
    });
    return rows.reduce((total, row) => total + BigInt(row.amount), 0n);
  }

  async withTargetPaymentLock<T>(callback: () => Promise<T>): Promise<T> {
    return this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(1952001)::text AS lock_result`;
      return callback();
    }, { maxWait: 10_000, timeout: 35_000 });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async getChainCursor(key: string): Promise<bigint | null> {
    const cursor = await this.client.chainCursor.findUnique({ where: { id: key } });
    return cursor ? BigInt(cursor.block) : null;
  }

  async saveChainCursor(key: string, block: bigint): Promise<void> {
    await this.client.chainCursor.upsert({
      where: { id: key },
      create: { id: key, block: block.toString() },
      update: { block: block.toString() },
    });
  }

  async settledLaunchPaymentsByPayerSince(payer: string, timestamp: string): Promise<number> {
    return this.client.payment.count({
      where: {
        kind: "launchproof",
        status: "settled",
        payer: { equals: payer, mode: "insensitive" },
        createdAt: { gte: new Date(timestamp) },
      },
    });
  }

  async recoverableRuns(): Promise<RunProgress[]> {
    const rows = await this.client.run.findMany({
      where: {
        OR: [
          { state: { in: ["payment_settled", "queued", "fetching_contract", "discovering", "fixed_sample", "invalid_input", "fresh_challenges"] } },
          { state: "target_payment_or_not_tested", payments: { some: { kind: "target", status: "settled" } } },
        ],
      },
      select: { record: true },
    });
    return rows
      .map((row) => row.record as unknown as RunProgress)
      .filter((run) => Boolean(run.payment));
  }
}

function isRunRecord(value: unknown): value is RunRecord {
  return Boolean(value && typeof value === "object" && "canonical_evidence" in value);
}

const stateOrder: Partial<Record<RunState, number>> = {
  payment_required: 0,
  settlement_claimed: 1,
  payment_settled: 2,
  queued: 3,
  fetching_contract: 4,
  discovering: 5,
  fixed_sample: 6,
  invalid_input: 7,
  fresh_challenges: 8,
  target_payment_or_not_tested: 9,
  canonicalizing: 10,
  publishing_on_chain: 11,
  complete: 12,
  complete_local: 12,
};

function canAdvance(current: RunState, next: RunState): boolean {
  if (next === "failed" || current === next) return true;
  if (current === "failed" || current === "complete" || current === "complete_local") return false;
  return (stateOrder[next] ?? -1) >= (stateOrder[current] ?? -1);
}

async function expireCapacityClaims(transaction: Prisma.TransactionClient, observedAt: Date): Promise<void> {
  const expired = await transaction.run.findMany({
    where: { state: "settlement_claimed", capacityLeaseExpiresAt: { lte: observedAt } },
    select: { id: true },
  });
  for (const row of expired) await releaseCapacityClaim(transaction, row.id);
}

async function releaseCapacityClaim(transaction: Prisma.TransactionClient, runId: string): Promise<void> {
  const row = await transaction.run.findUnique({ where: { id: runId }, select: { record: true, state: true } });
  if (!row || row.state !== "settlement_claimed") return;
  const progress = row.record as unknown as RunProgress;
  const released: RunProgress = {
    ...progress,
    state: "payment_required",
    capacity_lease_expires_at: null,
    updated_at: new Date().toISOString(),
  };
  await transaction.run.update({
    where: { id: runId },
    data: { state: "payment_required", capacityLeaseExpiresAt: null, record: json(released) },
  });
}

async function countCapacity(transaction: Prisma.TransactionClient, since: string): Promise<number> {
  return transaction.run.count({
    where: { createdAt: { gte: new Date(since) }, state: { not: "payment_required" } },
  });
}

function samePersistedPayment(
  existing: {
    runId: string;
    kind: string;
    amount: string;
    asset: string;
    network: string;
    payer: string | null;
    recipient: string | null;
    route: string;
    settlementTransaction: string | null;
    status: string;
    createdAt: Date;
    amountDisplay: string;
    assetDecimals: number;
  },
  payment: PaymentReference,
  runId: string,
): boolean {
  return existing.runId === runId &&
    existing.kind === payment.kind &&
    existing.amount === payment.amount &&
    existing.amountDisplay === payment.amount_display &&
    existing.assetDecimals === payment.asset_decimals &&
    existing.asset.toLowerCase() === payment.asset.toLowerCase() &&
    existing.network === payment.network &&
    existing.payer?.toLowerCase() === payment.payer?.toLowerCase() &&
    existing.recipient?.toLowerCase() === payment.recipient?.toLowerCase() &&
    existing.route === payment.route &&
    existing.settlementTransaction?.toLowerCase() === payment.settlement_transaction?.toLowerCase() &&
    existing.status === payment.status &&
    existing.createdAt.toISOString() === payment.timestamp;
}

function samePaymentReference(existing: PaymentReference, payment: PaymentReference): boolean {
  return existing.payment_id === payment.payment_id &&
    existing.kind === payment.kind &&
    existing.amount === payment.amount &&
    existing.amount_atomic === payment.amount_atomic &&
    existing.amount_display === payment.amount_display &&
    existing.asset_decimals === payment.asset_decimals &&
    existing.asset.toLowerCase() === payment.asset.toLowerCase() &&
    existing.network === payment.network &&
    existing.payer?.toLowerCase() === payment.payer?.toLowerCase() &&
    existing.recipient?.toLowerCase() === payment.recipient?.toLowerCase() &&
    existing.route === payment.route &&
    existing.settlement_transaction?.toLowerCase() === payment.settlement_transaction?.toLowerCase() &&
    existing.status === payment.status &&
    existing.timestamp === payment.timestamp;
}

function sameSettlement(existing: SettlementProgress | null | undefined, candidate: SettlementProgress): boolean {
  return Boolean(existing) &&
    existing!.transaction_hash.toLowerCase() === candidate.transaction_hash.toLowerCase() &&
    existing!.payer.toLowerCase() === candidate.payer.toLowerCase() &&
    existing!.amount_atomic === candidate.amount_atomic &&
    existing!.route === candidate.route;
}

function settlementMatchesPayment(settlement: SettlementProgress | null | undefined, payment: PaymentReference): boolean {
  return Boolean(settlement && payment.settlement_transaction && payment.payer) &&
    settlement!.transaction_hash.toLowerCase() === payment.settlement_transaction!.toLowerCase() &&
    settlement!.payer.toLowerCase() === payment.payer!.toLowerCase() &&
    settlement!.amount_atomic === payment.amount_atomic &&
    settlement!.route === payment.route;
}
