import { describe, expect, it } from "vitest";
import { ReadOnlyRepository, ReadOnlyRepositoryError } from "../src/db/read-only-store.js";
import { MemoryRepository } from "../src/db/store.js";

describe("read-only repository boundary", () => {
  it("delegates reads but refuses every mutating or advisory-lock operation", async () => {
    const inner = new MemoryRepository();
    await inner.createProgress({
      run_id: "existing-run",
      idempotency_key: "existing-key",
      state: "payment_required",
      target: "https://fixture.example",
      operation: "genesis",
      previous_run_id: null,
      payment: null,
      created_at: "2026-07-24T00:00:00.000Z",
      updated_at: "2026-07-24T00:00:00.000Z",
      error: null,
    });
    const repository = new ReadOnlyRepository(inner);
    expect((await repository.getRun("existing-run"))?.run_id).toBe("existing-run");
    expect(await repository.healthCheck()).toBe(true);

    const mutations = [
      () => repository.createProgress(undefined as never),
      () => repository.updateState("run", "failed"),
      () => repository.saveRun(undefined as never),
      () => repository.savePayment(undefined as never, "run"),
      () => repository.authorizeRun(undefined as never, "run"),
      () => repository.claimRunCapacity("run", { since: "", limit: 1 }, ""),
      () => repository.releaseRunCapacity("run"),
      () => repository.releaseExpiredRunCapacity("run", ""),
      () => repository.markPaymentAmbiguous("run", "error"),
      () => repository.recordPaymentSettlement("run", undefined as never),
      () => repository.resetPaymentAmbiguous("run"),
      () => repository.recordPublicationAttempt("run", undefined as never),
      () => repository.recordTargetPaymentAttempt("run", undefined as never),
      () => repository.recordTargetPaymentTransaction("run", "0x"),
      () => repository.clearTargetPaymentAttempt("run"),
      () => repository.withTargetPaymentLock(async () => undefined),
      () => repository.saveChainCursor("cursor", 1n),
    ];
    for (const mutate of mutations) {
      await expect(mutate()).rejects.toBeInstanceOf(ReadOnlyRepositoryError);
    }
    expect(await inner.getByIdempotencyKey("existing-key")).not.toBeNull();
  });
});
