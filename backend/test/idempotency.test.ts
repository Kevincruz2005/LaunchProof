import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/db/store.js";
import { RehearsalService } from "../src/workers/rehearsal.js";
import type { PaymentReference } from "../src/domain/types.js";

describe("atomic run reservation", () => {
  it("returns one run for concurrent requests with the same idempotency key", async () => {
    const repository = new MemoryRepository();
    const service = new RehearsalService(loadConfig({ NODE_ENV: "test" }), repository);
    const reservations = await Promise.all(
      Array.from({ length: 12 }, () => service.reserve("https://fixture.example", "same-request-key")),
    );
    expect(new Set(reservations.map((run) => run.run_id)).size).toBe(1);
    expect(reservations.every((run) => run.state === "payment_required")).toBe(true);
  });

  it("rejects reuse for a different target or operation", async () => {
    const repository = new MemoryRepository();
    const service = new RehearsalService(loadConfig({ NODE_ENV: "test" }), repository);
    await service.reserve("https://fixture.example", "semantic-request-key", "genesis", null);
    await expect(service.reserve("https://other.example", "semantic-request-key", "genesis", null)).rejects.toThrow(/different target/);
    await expect(service.reserve("https://fixture.example", "semantic-request-key", "renewal", "previous")).rejects.toThrow(/operation/);
  });

  it("counts only durably authorized runs toward daily capacity", async () => {
    const repository = new MemoryRepository();
    const config = loadConfig({ NODE_ENV: "test", GLOBAL_RUN_LIMIT_PER_DAY: "1" });
    const service = new RehearsalService(config, repository);
    const first = await service.reserve("https://fixture.example", "capacity-key-one");
    expect((await service.reserve("https://fixture.example", "capacity-key-one")).run_id).toBe(first.run_id);
    const second = await service.reserve("https://other.example", "capacity-key-two");
    const capacity = { since: "2026-01-01T00:00:00.000Z", limit: 1 };
    const payment = (id: string): PaymentReference => ({
      payment_id: id,
      kind: "launchproof",
      amount: "10000",
      amount_atomic: "10000",
      amount_display: "0.01",
      asset_decimals: config.chain.usdt0Decimals,
      asset: config.chain.usdt0Address,
      network: config.chain.network,
      payer: null,
      recipient: null,
      route: "/api/rehearsals",
      settlement_transaction: null,
      status: "local_only",
      timestamp: "2026-07-16T00:00:00.000Z",
    });
    await repository.authorizeRun(payment("local-capacity-one"), first.run_id, capacity);
    await repository.authorizeRun(payment("local-capacity-one"), first.run_id, capacity);
    await expect(repository.authorizeRun(payment("local-capacity-two"), second.run_id, capacity)).rejects.toThrow(/daily rehearsal capacity/);
    expect((await repository.getRun(second.run_id))?.state).toBe("payment_required");
  });

  it("claims capacity before settlement and releases an expired or aborted claim", async () => {
    const repository = new MemoryRepository();
    const service = new RehearsalService(loadConfig({ NODE_ENV: "test" }), repository);
    const first = await service.reserve("https://fixture.example", "claim-capacity-one");
    const second = await service.reserve("https://other.example", "claim-capacity-two");
    const capacity = { since: "2026-01-01T00:00:00.000Z", limit: 1 };

    await repository.claimRunCapacity(first.run_id, capacity, "2099-01-01T00:00:00.000Z");
    expect((await repository.getRun(first.run_id))?.state).toBe("settlement_claimed");
    await expect(repository.claimRunCapacity(second.run_id, capacity, "2099-01-01T00:00:00.000Z"))
      .rejects.toThrow(/daily rehearsal capacity/);

    await repository.releaseRunCapacity(first.run_id);
    expect((await repository.getRun(first.run_id))?.state).toBe("payment_required");
    await repository.claimRunCapacity(second.run_id, capacity, "2020-01-01T00:00:00.000Z");
    expect(await repository.releaseExpiredRunCapacity(second.run_id, "2026-07-17T00:00:00.000Z")).toBe(true);
    expect((await repository.getRun(second.run_id))?.state).toBe("payment_required");
  });

  it("recovers only the exact durable settlement candidate", async () => {
    const repository = new MemoryRepository();
    const config = loadConfig({ NODE_ENV: "test" });
    const service = new RehearsalService(config, repository);
    const run = await service.reserve("https://fixture.example", "durable-settlement-key");
    const capacity = { since: "2026-01-01T00:00:00.000Z", limit: 1 };
    const tx = `0x${"ab".repeat(32)}`;
    const payer = `0x${"12".repeat(20)}`;
    await repository.claimRunCapacity(run.run_id, capacity, "2099-01-01T00:00:00.000Z");
    await repository.recordPaymentSettlement(run.run_id, {
      transaction_hash: tx,
      payer,
      amount_atomic: "10000",
      route: "/api/rehearsals",
      observed_at: "2026-07-17T00:00:00.000Z",
    });
    expect((await repository.pendingPaymentSettlements()).map((item) => item.run_id)).toEqual([run.run_id]);
    const payment: PaymentReference = {
      payment_id: tx,
      kind: "launchproof",
      amount: "10000",
      amount_atomic: "10000",
      amount_display: "0.01",
      asset_decimals: config.chain.usdt0Decimals,
      asset: config.chain.usdt0Address,
      network: config.chain.network,
      payer,
      recipient: null,
      route: "/api/rehearsals",
      settlement_transaction: tx,
      status: "settled",
      timestamp: "2026-07-17T00:00:01.000Z",
    };
    await expect(repository.authorizeRun({ ...payment, amount_atomic: "10001", amount: "10001" }, run.run_id, capacity))
      .rejects.toThrow(/capacity claim/);
    await repository.authorizeRun(payment, run.run_id, capacity);
    expect((await repository.getRun(run.run_id))?.state).toBe("payment_settled");
  });
});
