import { describe, expect, it } from "vitest";
import type { PaymentRequirements, SettleResponse } from "@okxweb3/x402-core/types";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/db/store.js";
import { rehearsalTargetSchemaFor, requireBoundIdempotencyKey, settledPaymentReference, settlementProgress } from "../src/payments/inbound.js";
import { RehearsalService } from "../src/workers/rehearsal.js";

const payout = `0x${"34".repeat(20)}` as const;
const transaction = `0x${"ab".repeat(32)}` as const;
const payer = `0x${"12".repeat(20)}` as const;
const config = loadConfig({ NODE_ENV: "test", PAYOUT_ADDRESS: payout });
const blockTimestamp = "2026-07-16T05:30:00.000Z";

function settlement(overrides: Partial<SettleResponse> = {}): SettleResponse {
  return {
    success: true,
    status: "success",
    transaction,
    network: config.chain.network,
    payer,
    amount: "10000",
    ...overrides,
  };
}

function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.chain.network,
    asset: config.chain.usdt0Address,
    amount: "10000",
    payTo: payout,
    maxTimeoutSeconds: 60,
    extra: {},
    ...overrides,
  };
}

describe("settled LaunchProof payment references", () => {
  it("permits loopback targets only for the explicit local schema", () => {
    expect(rehearsalTargetSchemaFor(true).parse("http://127.0.0.1:4101")).toBe("http://127.0.0.1:4101");
    expect(() => rehearsalTargetSchemaFor(false).parse("http://127.0.0.1:4101")).toThrow();
  });

  it("binds the header and body idempotency keys before settlement", () => {
    expect(requireBoundIdempotencyKey("same-payment-key", { idempotency_key: "same-payment-key" })).toBe("same-payment-key");
    expect(() => requireBoundIdempotencyKey("header-payment-key", { idempotency_key: "body-payment-key" }))
      .toThrow(/exactly match/);
    expect(() => requireBoundIdempotencyKey(undefined, { idempotency_key: "body-payment-key" }))
      .toThrow(/header/);
  });

  it("binds a strictly validated settlement and explicit atomic/display units", async () => {
    const reference = await settledPaymentReference(
      config,
      settlement(),
      requirements(),
      "/api/rehearsals",
      async () => blockTimestamp,
    );
    expect(reference.payment_id).toBe(transaction);
    expect(reference.settlement_transaction).toBe(transaction);
    expect(reference.payer).toBe(payer);
    expect(reference.status).toBe("settled");
    expect(reference.amount).toBe("10000");
    expect(reference.amount_atomic).toBe("10000");
    expect(reference.amount_display).toBe("0.01");
    expect(reference.timestamp).toBe(blockTimestamp);
  });

  it("fails closed for a pending result or mismatched policy", async () => {
    await expect(settledPaymentReference(
      config,
      settlement({ status: "pending" }),
      requirements(),
      "/api/rehearsals",
      async () => blockTimestamp,
    )).rejects.toThrow(/not final/);
    await expect(settledPaymentReference(
      config,
      settlement(),
      requirements({ payTo: `0x${"56".repeat(20)}` }),
      "/api/rehearsals",
      async () => blockTimestamp,
    )).rejects.toThrow(/payment policy/);
  });

  it("durably captures an OKX timeout transaction for authenticated status polling", () => {
    expect(settlementProgress(
      config,
      settlement({ status: "timeout" }),
      requirements(),
      "/api/rehearsals",
    )).toMatchObject({ transaction_hash: transaction, payer, amount_atomic: "10000" });
    expect(() => settlementProgress(
      config,
      settlement({ status: "pending" }),
      requirements(),
      "/api/rehearsals",
    )).toThrow(/recoverable transaction/);
  });

  it("reconstructs the exact same immutable reference for a same-transaction retry", async () => {
    const first = await settledPaymentReference(config, settlement(), requirements(), "/api/rehearsals", async () => blockTimestamp);
    const retry = await settledPaymentReference(config, settlement(), requirements(), "/api/rehearsals", async () => blockTimestamp);
    expect(retry).toEqual(first);
  });

  it("serializes target budget/payment critical sections", async () => {
    const repository = new MemoryRepository();
    let active = 0;
    let maximum = 0;
    await Promise.all(Array.from({ length: 8 }, () => repository.withTargetPaymentLock(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
    })));
    expect(maximum).toBe(1);
  });

  it("persists one immutable signed target authorization before settlement", async () => {
    const repository = new MemoryRepository();
    const service = new RehearsalService(config, repository);
    const run = await service.reserve("https://fixture.example", "durable-target-payment");
    await repository.updateState(run.run_id, "target_payment_or_not_tested");
    const attempt = {
      asset: config.chain.usdt0Address,
      network: config.chain.network,
      payer,
      recipient: payout,
      amount_atomic: "10000",
      route: "https://fixture.example/paid",
      source_revision: "a".repeat(40),
      authorization_nonce: `0x${"cd".repeat(32)}`,
      authorization_valid_before: "2000000000",
      start_block: "100",
      created_at: "2026-07-17T00:00:00.000Z",
      transaction_hash: null,
      payment_payload: { signature: "public-signed-authorization" },
    };
    await repository.recordTargetPaymentAttempt(run.run_id, attempt);
    expect((await repository.pendingTargetPaymentAttempts())[0]?.target_payment_attempt).toEqual(attempt);
    await expect(repository.recordTargetPaymentAttempt(run.run_id, {
      ...attempt,
      authorization_nonce: `0x${"ef".repeat(32)}`,
    })).rejects.toThrow(/immutable/);
    await repository.recordTargetPaymentTransaction(run.run_id, transaction);
    await expect(repository.recordTargetPaymentTransaction(run.run_id, `0x${"ef".repeat(32)}`)).rejects.toThrow(/immutable/);
    await repository.clearTargetPaymentAttempt(run.run_id);
    const reset = await repository.getRun(run.run_id);
    expect(reset?.state).toBe("payment_settled");
    expect(reset && !("canonical_evidence" in reset) ? reset.target_payment_attempt : undefined).toBeNull();
  });
});
