import type { PaymentReference, RunRecord, RunState } from "../domain/types.js";
import pLimit from "p-limit";

export interface RunProgress {
  run_id: string;
  idempotency_key: string;
  state: RunState;
  target: string;
  operation: "genesis" | "renewal";
  previous_run_id: string | null;
  payment: PaymentReference | null;
  capacity_lease_expires_at?: string | null;
  settlement?: SettlementProgress | null;
  publication?: PublicationProgress | null;
  target_payment_attempt?: TargetPaymentAttempt | null;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface SettlementProgress {
  transaction_hash: string;
  payer: string;
  amount_atomic: string;
  route: string;
  observed_at: string;
}

export interface PublicationProgress {
  transaction_hash: string;
  evidence_hash: string;
  started_at: string;
  /** Exact immutable candidate used for this transaction; required for safe recovery. */
  candidate: RunRecord;
}

export interface TargetPaymentAttempt {
  asset: string;
  network: string;
  payer: string;
  recipient: string;
  amount_atomic: string;
  route: string;
  source_revision: string;
  authorization_nonce: string;
  authorization_valid_before: string;
  start_block: string;
  created_at: string;
  transaction_hash: string | null;
  /** Exact signed x402 payload; public authorization data needed for deterministic recovery. */
  payment_payload: Record<string, unknown>;
}

export type StoredRun = RunRecord | RunProgress;

export interface RunCapacity {
  since: string;
  limit: number;
}

export class RunCapacityError extends Error {}

export interface Repository {
  createProgress(progress: RunProgress): Promise<StoredRun>;
  updateState(runId: string, state: RunState, error?: string): Promise<void>;
  saveRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<StoredRun | null>;
  getByIdempotencyKey(key: string): Promise<StoredRun | null>;
  recentRuns(limit: number): Promise<RunRecord[]>;
  savePayment(payment: PaymentReference, runId: string): Promise<void>;
  authorizeRun(payment: PaymentReference, runId: string, capacity?: RunCapacity): Promise<void>;
  claimRunCapacity(runId: string, capacity: RunCapacity, leaseExpiresAt: string): Promise<void>;
  releaseRunCapacity(runId: string): Promise<void>;
  releaseExpiredRunCapacity(runId: string, observedAt: string): Promise<boolean>;
  markPaymentAmbiguous(runId: string, error: string): Promise<void>;
  recordPaymentSettlement(runId: string, settlement: SettlementProgress): Promise<void>;
  resetPaymentAmbiguous(runId: string): Promise<void>;
  pendingPaymentSettlements(): Promise<RunProgress[]>;
  recordPublicationAttempt(runId: string, progress: PublicationProgress): Promise<void>;
  pendingPublications(): Promise<RunProgress[]>;
  recordTargetPaymentAttempt(runId: string, attempt: TargetPaymentAttempt): Promise<void>;
  recordTargetPaymentTransaction(runId: string, transactionHash: string): Promise<void>;
  clearTargetPaymentAttempt(runId: string): Promise<void>;
  pendingTargetPaymentAttempts(): Promise<RunProgress[]>;
  getPayment(paymentId: string): Promise<(PaymentReference & { run_id: string }) | null>;
  getTargetPaymentForRun(runId: string): Promise<PaymentReference | null>;
  targetSpendSince(timestamp: string): Promise<bigint>;
  withTargetPaymentLock<T>(callback: () => Promise<T>): Promise<T>;
  healthCheck(): Promise<boolean>;
  getChainCursor(key: string): Promise<bigint | null>;
  saveChainCursor(key: string, block: bigint): Promise<void>;
  settledLaunchPaymentsByPayerSince(payer: string, timestamp: string): Promise<number>;
  recoverableRuns(): Promise<RunProgress[]>;
}

export class MemoryRepository implements Repository {
  private readonly runs = new Map<string, StoredRun>();
  private readonly idempotency = new Map<string, string>();
  private readonly payments = new Map<string, PaymentReference & { run_id: string }>();
  private readonly paymentTransactions = new Map<string, string>();
  private readonly paymentKinds = new Map<string, string>();
  private readonly targetPaymentLock = pLimit(1);
  private readonly authorizationLock = pLimit(1);
  private readonly chainCursors = new Map<string, bigint>();

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
    const current = this.runs.get(run.run_id);
    if (current && "canonical_evidence" in current) {
      if (current.canonical_evidence_jcs !== run.canonical_evidence_jcs) {
        throw new Error("Finalized run cannot be overwritten with different evidence");
      }
      return;
    }
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
    const existing = this.payments.get(payment.payment_id);
    if (existing && !samePayment(existing, payment, runId)) {
      throw new Error("Payment ID is already bound to a different run or settlement");
    }
    if (payment.settlement_transaction) {
      const transactionOwner = this.paymentTransactions.get(payment.settlement_transaction.toLowerCase());
      if (transactionOwner && transactionOwner !== payment.payment_id) {
        throw new Error("Settlement transaction is already bound to another payment");
      }
      this.paymentTransactions.set(payment.settlement_transaction.toLowerCase(), payment.payment_id);
    }
    const kindKey = `${runId}:${payment.kind}`;
    const kindOwner = this.paymentKinds.get(kindKey);
    if (kindOwner && kindOwner !== payment.payment_id) {
      throw new Error("Run already has a different payment for this kind");
    }
    this.paymentKinds.set(kindKey, payment.payment_id);
    this.payments.set(payment.payment_id, { ...payment, run_id: runId });
  }

  async authorizeRun(payment: PaymentReference, runId: string, capacity?: RunCapacity): Promise<void> {
    return this.authorizationLock(async () => {
      const current = this.runs.get(runId);
      if (!current) throw new Error("Cannot authorize a missing run reservation");
      if ("canonical_evidence" in current) {
        if (!samePaymentReference(current.payment, payment)) throw new Error("Run authorization payment is immutable");
        await this.savePayment(payment, runId);
        return;
      }
      if (current.payment) {
        if (!samePaymentReference(current.payment, payment)) throw new Error("Run authorization payment is immutable");
        await this.savePayment(payment, runId);
        return;
      }
      if (payment.status === "settled") {
        if (current.state !== "settlement_claimed" &&
          !(current.state === "payment_ambiguous" && settlementMatchesPayment(current.settlement, payment))) {
          throw new Error("Settled payment has no durable pre-settlement capacity claim");
        }
      } else if (capacity) {
        this.expireCapacityClaims(new Date().toISOString());
        if (this.capacityCount(capacity.since) >= capacity.limit) {
          throw new RunCapacityError("Global daily rehearsal capacity has been reached");
        }
      }
      await this.savePayment(payment, runId);
      this.runs.set(runId, {
        ...current,
        payment,
        state: "payment_settled",
        capacity_lease_expires_at: null,
        updated_at: new Date().toISOString(),
      });
    });
  }

  async claimRunCapacity(runId: string, capacity: RunCapacity, leaseExpiresAt: string): Promise<void> {
    return this.authorizationLock(async () => {
      const observedAt = new Date().toISOString();
      this.expireCapacityClaims(observedAt);
      const current = this.runs.get(runId);
      if (!current || "canonical_evidence" in current) throw new Error("Cannot claim capacity for a missing or finalized run");
      if (current.state !== "payment_required" || current.payment) throw new Error("Run is not awaiting a payment capacity claim");
      if (this.capacityCount(capacity.since) >= capacity.limit) {
        throw new RunCapacityError("Global daily rehearsal capacity has been reached");
      }
      this.runs.set(runId, {
        ...current,
        state: "settlement_claimed",
        capacity_lease_expires_at: leaseExpiresAt,
        updated_at: observedAt,
      });
    });
  }

  async releaseRunCapacity(runId: string): Promise<void> {
    return this.authorizationLock(async () => this.releaseCapacity(runId));
  }

  async releaseExpiredRunCapacity(runId: string, observedAt: string): Promise<boolean> {
    return this.authorizationLock(async () => {
      const current = this.runs.get(runId);
      if (!current || "canonical_evidence" in current || current.state !== "settlement_claimed" ||
        !current.capacity_lease_expires_at || current.capacity_lease_expires_at > observedAt) return false;
      this.releaseCapacity(runId);
      return true;
    });
  }

  async markPaymentAmbiguous(runId: string, error: string): Promise<void> {
    return this.authorizationLock(async () => {
      const current = this.runs.get(runId);
      if (!current || "canonical_evidence" in current ||
        (current.state !== "settlement_claimed" && current.state !== "payment_ambiguous")) return;
      this.runs.set(runId, {
        ...current,
        state: "payment_ambiguous",
        capacity_lease_expires_at: null,
        updated_at: new Date().toISOString(),
        error: error.slice(0, 500),
      });
    });
  }

  async recordPaymentSettlement(runId: string, settlement: SettlementProgress): Promise<void> {
    return this.authorizationLock(async () => {
      const current = this.runs.get(runId);
      if (!current || "canonical_evidence" in current) throw new Error("Cannot record settlement for a missing or finalized run");
      if (current.state === "payment_ambiguous") {
        if (sameSettlement(current.settlement, settlement)) return;
        if (current.settlement) throw new Error("Settlement transaction is immutable");
      } else if (current.state !== "settlement_claimed") {
        throw new Error("Settlement has no durable capacity claim");
      }
      this.runs.set(runId, {
        ...current,
        state: "payment_ambiguous",
        settlement,
        capacity_lease_expires_at: null,
        updated_at: settlement.observed_at,
      });
    });
  }

  async resetPaymentAmbiguous(runId: string): Promise<void> {
    return this.authorizationLock(async () => {
      const current = this.runs.get(runId);
      if (!current || "canonical_evidence" in current || current.state !== "payment_ambiguous") return;
      this.runs.set(runId, {
        ...current,
        state: "payment_required",
        settlement: null,
        capacity_lease_expires_at: null,
        updated_at: new Date().toISOString(),
        error: null,
      });
    });
  }

  async pendingPaymentSettlements(): Promise<RunProgress[]> {
    return [...this.runs.values()].filter((run): run is RunProgress =>
      !("canonical_evidence" in run) && run.state === "payment_ambiguous" && Boolean(run.settlement)
    );
  }

  async recordPublicationAttempt(runId: string, publication: PublicationProgress): Promise<void> {
    const current = this.runs.get(runId);
    if (!current || "canonical_evidence" in current) return;
    this.runs.set(runId, { ...current, state: "publishing_on_chain", publication, updated_at: publication.started_at });
  }

  async pendingPublications(): Promise<RunProgress[]> {
    return [...this.runs.values()].filter((run): run is RunProgress =>
      !("canonical_evidence" in run) && run.state === "publishing_on_chain" && Boolean(run.publication)
    );
  }

  async recordTargetPaymentAttempt(runId: string, attempt: TargetPaymentAttempt): Promise<void> {
    const current = this.runs.get(runId);
    if (!current || "canonical_evidence" in current) throw new Error("Cannot record target payment for a missing or finalized run");
    if (current.target_payment_attempt && JSON.stringify(current.target_payment_attempt) !== JSON.stringify(attempt)) {
      throw new Error("Target payment authorization is immutable");
    }
    this.runs.set(runId, { ...current, target_payment_attempt: attempt, updated_at: attempt.created_at });
  }

  async recordTargetPaymentTransaction(runId: string, transactionHash: string): Promise<void> {
    const current = this.runs.get(runId);
    if (!current || "canonical_evidence" in current || !current.target_payment_attempt) {
      throw new Error("Target settlement has no durable signed authorization");
    }
    const existing = current.target_payment_attempt.transaction_hash;
    if (existing && existing.toLowerCase() !== transactionHash.toLowerCase()) {
      throw new Error("Target settlement transaction is immutable");
    }
    this.runs.set(runId, {
      ...current,
      target_payment_attempt: { ...current.target_payment_attempt, transaction_hash: transactionHash },
      updated_at: new Date().toISOString(),
    });
  }

  async clearTargetPaymentAttempt(runId: string): Promise<void> {
    const current = this.runs.get(runId);
    if (!current || "canonical_evidence" in current) return;
    this.runs.set(runId, {
      ...current,
      state: "payment_settled",
      target_payment_attempt: null,
      updated_at: new Date().toISOString(),
    });
  }

  async pendingTargetPaymentAttempts(): Promise<RunProgress[]> {
    return [...this.runs.values()].filter((run): run is RunProgress =>
      !("canonical_evidence" in run) && Boolean(run.target_payment_attempt)
    );
  }

  async getPayment(paymentId: string): Promise<(PaymentReference & { run_id: string }) | null> {
    return this.payments.get(paymentId) ?? null;
  }

  async getTargetPaymentForRun(runId: string): Promise<PaymentReference | null> {
    const payment = [...this.payments.values()].find((item) =>
      item.run_id === runId && item.kind === "target" && item.status === "settled"
    );
    if (!payment) return null;
    const { run_id: _runId, ...reference } = payment;
    return reference;
  }

  async targetSpendSince(timestamp: string): Promise<bigint> {
    return [...this.payments.values()]
      .filter((payment) => payment.kind === "target" && payment.status === "settled" && payment.timestamp >= timestamp)
      .reduce((total, payment) => total + BigInt(payment.amount), 0n);
  }

  async withTargetPaymentLock<T>(callback: () => Promise<T>): Promise<T> {
    return this.targetPaymentLock(callback);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async getChainCursor(key: string): Promise<bigint | null> {
    return this.chainCursors.get(key) ?? null;
  }

  async saveChainCursor(key: string, block: bigint): Promise<void> {
    this.chainCursors.set(key, block);
  }

  async settledLaunchPaymentsByPayerSince(payer: string, timestamp: string): Promise<number> {
    return [...this.payments.values()].filter((payment) =>
      payment.kind === "launchproof" &&
      payment.status === "settled" &&
      payment.payer?.toLowerCase() === payer.toLowerCase() &&
      payment.timestamp >= timestamp
    ).length;
  }

  async recoverableRuns(): Promise<RunProgress[]> {
    return [...this.runs.values()].filter((run): run is RunProgress =>
      !("canonical_evidence" in run) &&
      ["payment_settled", "queued", "fetching_contract", "discovering", "fixed_sample", "invalid_input", "fresh_challenges", "target_payment_or_not_tested"]
        .includes(run.state) &&
      Boolean(run.payment) &&
      (run.state !== "target_payment_or_not_tested" || Boolean(
        [...this.payments.values()].find((payment) => payment.run_id === run.run_id && payment.kind === "target" && payment.status === "settled")
      ))
    );
  }

  private capacityCount(since: string): number {
    return [...this.runs.values()].filter((run) => {
      if ("canonical_evidence" in run) return run.generated_at >= since;
      return run.state !== "payment_required" && run.created_at >= since;
    }).length;
  }

  private expireCapacityClaims(observedAt: string): void {
    for (const [runId, run] of this.runs.entries()) {
      if ("canonical_evidence" in run || run.state !== "settlement_claimed" ||
        !run.capacity_lease_expires_at || run.capacity_lease_expires_at > observedAt) continue;
      this.releaseCapacity(runId);
    }
  }

  private releaseCapacity(runId: string): void {
    const current = this.runs.get(runId);
    if (!current || "canonical_evidence" in current || current.state !== "settlement_claimed") return;
    this.runs.set(runId, {
      ...current,
      state: "payment_required",
      capacity_lease_expires_at: null,
      updated_at: new Date().toISOString(),
    });
  }
}

function samePayment(
  existing: PaymentReference & { run_id: string },
  payment: PaymentReference,
  runId: string,
): boolean {
  return existing.run_id === runId &&
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

function samePaymentReference(existing: PaymentReference, payment: PaymentReference): boolean {
  return existing.payment_id === payment.payment_id && samePayment({ ...existing, run_id: "same" }, payment, "same");
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
