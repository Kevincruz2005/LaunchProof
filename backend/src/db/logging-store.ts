import type { PaymentReference, RunRecord, RunState } from "../domain/types.js";
import type {
  PublicationProgress,
  Repository,
  RunCapacity,
  RunProgress,
  SettlementProgress,
  StoredRun,
  TargetPaymentAttempt,
} from "./store.js";

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
  authorizeRun(payment: PaymentReference, runId: string, capacity?: RunCapacity) { return this.inner.authorizeRun(payment, runId, capacity); }
  claimRunCapacity(runId: string, capacity: RunCapacity, leaseExpiresAt: string) {
    return this.inner.claimRunCapacity(runId, capacity, leaseExpiresAt);
  }
  releaseRunCapacity(runId: string) { return this.inner.releaseRunCapacity(runId); }
  releaseExpiredRunCapacity(runId: string, observedAt: string) {
    return this.inner.releaseExpiredRunCapacity(runId, observedAt);
  }
  markPaymentAmbiguous(runId: string, error: string) { return this.inner.markPaymentAmbiguous(runId, error); }
  recordPaymentSettlement(runId: string, settlement: SettlementProgress) {
    return this.inner.recordPaymentSettlement(runId, settlement);
  }
  resetPaymentAmbiguous(runId: string) { return this.inner.resetPaymentAmbiguous(runId); }
  pendingPaymentSettlements() { return this.inner.pendingPaymentSettlements(); }
  recordPublicationAttempt(runId: string, publication: PublicationProgress) {
    return this.inner.recordPublicationAttempt(runId, publication);
  }
  pendingPublications() { return this.inner.pendingPublications(); }
  recordTargetPaymentAttempt(runId: string, attempt: TargetPaymentAttempt) {
    return this.inner.recordTargetPaymentAttempt(runId, attempt);
  }
  recordTargetPaymentTransaction(runId: string, transactionHash: string) {
    return this.inner.recordTargetPaymentTransaction(runId, transactionHash);
  }
  clearTargetPaymentAttempt(runId: string) { return this.inner.clearTargetPaymentAttempt(runId); }
  pendingTargetPaymentAttempts() { return this.inner.pendingTargetPaymentAttempts(); }

  getPayment(paymentId: string) { return this.inner.getPayment(paymentId); }
  getTargetPaymentForRun(runId: string) { return this.inner.getTargetPaymentForRun(runId); }
  targetSpendSince(timestamp: string) { return this.inner.targetSpendSince(timestamp); }
  withTargetPaymentLock<T>(callback: () => Promise<T>) { return this.inner.withTargetPaymentLock(callback); }
  healthCheck() { return this.inner.healthCheck(); }
  getChainCursor(key: string) { return this.inner.getChainCursor(key); }
  saveChainCursor(key: string, block: bigint) { return this.inner.saveChainCursor(key, block); }
  settledLaunchPaymentsByPayerSince(payer: string, timestamp: string) { return this.inner.settledLaunchPaymentsByPayerSince(payer, timestamp); }
  recoverableRuns() { return this.inner.recoverableRuns(); }
}

function event(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ ...value, observed_at: new Date().toISOString() })}\n`);
}
