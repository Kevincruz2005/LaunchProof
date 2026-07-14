import type { PaymentReference, RunRecord, RunState } from "../domain/types.js";
import type { Repository, RunProgress, StoredRun } from "./store.js";

/** Structured operational events contain identifiers and state only—never target payloads or secrets. */
export class LoggingRepository implements Repository {
  constructor(private readonly inner: Repository) {}

  async createProgress(progress: RunProgress): Promise<StoredRun> {
    const stored = await this.inner.createProgress(progress);
    event({ event: "run_reserved", run_id: stored.run_id, state: stored.state });
    return stored;
  }

  async updateState(runId: string, state: RunState, error?: string): Promise<void> {
    await this.inner.updateState(runId, state, error);
    event({ event: "run_state", run_id: runId, state, error_present: Boolean(error) });
  }

  async saveRun(run: RunRecord): Promise<void> {
    await this.inner.saveRun(run);
    event({ event: "run_saved", run_id: run.run_id, state: run.state, passport_status: run.passport_status, evidence_transaction: run.chain.evidence_transaction_hash });
  }

  getRun(runId: string) { return this.inner.getRun(runId); }
  getByIdempotencyKey(key: string) { return this.inner.getByIdempotencyKey(key); }
  recentRuns(limit: number) { return this.inner.recentRuns(limit); }

  async savePayment(payment: PaymentReference, runId: string): Promise<void> {
    await this.inner.savePayment(payment, runId);
    event({ event: "payment_saved", run_id: runId, payment_id: payment.payment_id, kind: payment.kind, status: payment.status, settlement_transaction: payment.settlement_transaction });
  }

  getPayment(paymentId: string) { return this.inner.getPayment(paymentId); }
  targetSpendSince(timestamp: string) { return this.inner.targetSpendSince(timestamp); }
}

function event(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ ...value, observed_at: new Date().toISOString() })}\n`);
}
