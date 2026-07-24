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

export class ReadOnlyRepositoryError extends Error {
  constructor(operation: string) {
    super(`Read-only backend refused repository mutation: ${operation}`);
    this.name = "ReadOnlyRepositoryError";
  }
}

/**
 * Defense-in-depth repository boundary for the Azure read-only candidate.
 *
 * The underlying runtime database role is also SELECT-only. This wrapper
 * ensures a route or service regression still fails before Prisma can issue a
 * mutating query or advisory transaction lock.
 */
export class ReadOnlyRepository implements Repository {
  constructor(private readonly inner: Repository) {}

  createProgress(_progress: RunProgress): Promise<StoredRun> { return refused("createProgress"); }
  updateState(_runId: string, _state: RunState, _error?: string): Promise<void> { return refused("updateState"); }
  saveRun(_run: RunRecord): Promise<void> { return refused("saveRun"); }
  savePayment(_payment: PaymentReference, _runId: string): Promise<void> { return refused("savePayment"); }
  authorizeRun(_payment: PaymentReference, _runId: string, _capacity?: RunCapacity): Promise<void> { return refused("authorizeRun"); }
  claimRunCapacity(_runId: string, _capacity: RunCapacity, _leaseExpiresAt: string): Promise<void> { return refused("claimRunCapacity"); }
  releaseRunCapacity(_runId: string): Promise<void> { return refused("releaseRunCapacity"); }
  releaseExpiredRunCapacity(_runId: string, _observedAt: string): Promise<boolean> { return refused("releaseExpiredRunCapacity"); }
  markPaymentAmbiguous(_runId: string, _error: string): Promise<void> { return refused("markPaymentAmbiguous"); }
  recordPaymentSettlement(_runId: string, _settlement: SettlementProgress): Promise<void> { return refused("recordPaymentSettlement"); }
  resetPaymentAmbiguous(_runId: string): Promise<void> { return refused("resetPaymentAmbiguous"); }
  recordPublicationAttempt(_runId: string, _progress: PublicationProgress): Promise<void> { return refused("recordPublicationAttempt"); }
  recordTargetPaymentAttempt(_runId: string, _attempt: TargetPaymentAttempt): Promise<void> { return refused("recordTargetPaymentAttempt"); }
  recordTargetPaymentTransaction(_runId: string, _transactionHash: string): Promise<void> { return refused("recordTargetPaymentTransaction"); }
  clearTargetPaymentAttempt(_runId: string): Promise<void> { return refused("clearTargetPaymentAttempt"); }
  withTargetPaymentLock<T>(_callback: () => Promise<T>): Promise<T> { return refused("withTargetPaymentLock"); }
  saveChainCursor(_key: string, _block: bigint): Promise<void> { return refused("saveChainCursor"); }

  getRun(runId: string) { return this.inner.getRun(runId); }
  getByIdempotencyKey(key: string) { return this.inner.getByIdempotencyKey(key); }
  recentRuns(limit: number) { return this.inner.recentRuns(limit); }
  passportsForTarget(target: string, provider: string) { return this.inner.passportsForTarget(target, provider); }
  pendingPaymentSettlements() { return this.inner.pendingPaymentSettlements(); }
  pendingPublications() { return this.inner.pendingPublications(); }
  pendingTargetPaymentAttempts() { return this.inner.pendingTargetPaymentAttempts(); }
  getPayment(paymentId: string) { return this.inner.getPayment(paymentId); }
  getTargetPaymentForRun(runId: string) { return this.inner.getTargetPaymentForRun(runId); }
  targetSpendSince(timestamp: string) { return this.inner.targetSpendSince(timestamp); }
  healthCheck() { return this.inner.healthCheck(); }
  getChainCursor(key: string) { return this.inner.getChainCursor(key); }
  settledLaunchPaymentsByPayerSince(payer: string, timestamp: string) {
    return this.inner.settledLaunchPaymentsByPayerSince(payer, timestamp);
  }
  recoverableRuns() { return this.inner.recoverableRuns(); }
}

function refused<T>(operation: string): Promise<T> {
  return Promise.reject(new ReadOnlyRepositoryError(operation));
}
