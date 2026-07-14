import type { PaymentReference, RunRecord, RunState } from "../domain/types.js";

export interface RunProgress {
  run_id: string;
  idempotency_key: string;
  state: RunState;
  target: string;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export type StoredRun = RunRecord | RunProgress;

export interface Repository {
  createProgress(progress: RunProgress): Promise<StoredRun>;
  updateState(runId: string, state: RunState, error?: string): Promise<void>;
  saveRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<StoredRun | null>;
  getByIdempotencyKey(key: string): Promise<StoredRun | null>;
  recentRuns(limit: number): Promise<RunRecord[]>;
  savePayment(payment: PaymentReference, runId: string): Promise<void>;
  getPayment(paymentId: string): Promise<(PaymentReference & { run_id: string }) | null>;
  targetSpendSince(timestamp: string): Promise<bigint>;
}

export class MemoryRepository implements Repository {
  private readonly runs = new Map<string, StoredRun>();
  private readonly idempotency = new Map<string, string>();
  private readonly payments = new Map<string, PaymentReference & { run_id: string }>();

  async createProgress(progress: RunProgress): Promise<StoredRun> {
    const existingId = this.idempotency.get(progress.idempotency_key);
    if (existingId) return this.runs.get(existingId)!;
    this.runs.set(progress.run_id, progress);
    this.idempotency.set(progress.idempotency_key, progress.run_id);
    return progress;
  }

  async updateState(runId: string, state: RunState, error: string | undefined = undefined): Promise<void> {
    const current = this.runs.get(runId);
    if (!current || "canonical_evidence" in current) return;
    this.runs.set(runId, {
      ...current,
      state,
      updated_at: new Date().toISOString(),
      error: error ? error.slice(0, 500) : current.error,
    });
  }

  async saveRun(run: RunRecord): Promise<void> {
    this.runs.set(run.run_id, run);
    this.idempotency.set(run.idempotency_key, run.run_id);
  }

  async getRun(runId: string): Promise<StoredRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<StoredRun | null> {
    const id = this.idempotency.get(key);
    return id ? (this.runs.get(id) ?? null) : null;
  }

  async recentRuns(limit: number): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((run): run is RunRecord => "canonical_evidence" in run)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
      .slice(0, limit);
  }

  async savePayment(payment: PaymentReference, runId: string): Promise<void> {
    this.payments.set(payment.payment_id, { ...payment, run_id: runId });
  }

  async getPayment(paymentId: string): Promise<(PaymentReference & { run_id: string }) | null> {
    return this.payments.get(paymentId) ?? null;
  }

  async targetSpendSince(timestamp: string): Promise<bigint> {
    return [...this.payments.values()]
      .filter((payment) => payment.kind === "target" && payment.status === "settled" && payment.timestamp >= timestamp)
      .reduce((total, payment) => total + BigInt(payment.amount), 0n);
  }
}
