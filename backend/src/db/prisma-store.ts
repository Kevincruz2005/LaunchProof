import type { Prisma as PrismaTypes, PrismaClient } from "../../prisma/client/index.d.ts";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Prisma, PrismaClient: PrismaClientClass } = require("../../prisma/client/index.js");
import type { PaymentReference, RunRecord, RunState } from "../domain/types.js";
import type { Repository, RunProgress, StoredRun } from "./store.js";

function json(value: unknown): PrismaTypes.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as PrismaTypes.InputJsonValue;
}

export class PrismaRepository implements Repository {
  constructor(private readonly client = new PrismaClientClass() as PrismaClient) {}

  async createProgress(progress: RunProgress): Promise<StoredRun> {
    const row = await this.client.run.upsert({
      where: { idempotencyKey: progress.idempotency_key },
      create: {
        id: progress.run_id,
        idempotencyKey: progress.idempotency_key,
        state: progress.state,
        target: progress.target,
        error: progress.error,
        record: json(progress),
      },
      update: {},
      select: { record: true },
    });
    return row.record as unknown as StoredRun;
  }

  async updateState(runId: string, state: RunState, error: string | undefined = undefined): Promise<void> {
    const current = await this.client.run.findUnique({ where: { id: runId }, select: { record: true } });
    const progress = (current?.record ?? {}) as unknown as Partial<RunProgress>;
    await this.client.run.update({
      where: { id: runId },
      data: {
        state,
        ...(error ? { error: error.slice(0, 500) } : {}),
        record: json({ ...progress, run_id: runId, state, updated_at: new Date().toISOString(), error: error ?? progress.error ?? null }),
      },
    });
  }

  async saveRun(run: RunRecord): Promise<void> {
    const invocations = [
      run.canonical_evidence.fixed_sample,
      run.canonical_evidence.invalid_input,
      ...run.canonical_evidence.challenges,
    ];
    await this.client.$transaction(async (transaction) => {
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
    await this.client.payment.upsert({
      where: { id: payment.payment_id },
      create: {
        id: payment.payment_id,
        runId,
        kind: payment.kind,
        payer: payment.payer,
        recipient: payment.recipient,
        amount: payment.amount,
        asset: payment.asset,
        network: payment.network,
        route: payment.route,
        settlementTransaction: payment.settlement_transaction,
        status: payment.status,
        createdAt: new Date(payment.timestamp),
      },
      update: {
        runId,
        kind: payment.kind,
        payer: payment.payer,
        recipient: payment.recipient,
        amount: payment.amount,
        asset: payment.asset,
        network: payment.network,
        route: payment.route,
        settlementTransaction: payment.settlement_transaction,
        status: payment.status,
        createdAt: new Date(payment.timestamp),
      },
    });
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
}
