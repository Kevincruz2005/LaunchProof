import { describe, expect, it, vi } from "vitest";
import {
  AmbiguousAcceptancePaymentError,
  runTestnetAcceptance,
  XLAYER_TESTNET_USDT0,
  type AcceptanceBoundary,
  type AcceptanceConfig,
  type AcceptancePolicy,
  type AcceptanceRun,
} from "../src/acceptance/harness.js";

const launchRecipient = `0x${"11".repeat(20)}`;
const targetRecipient = `0x${"22".repeat(20)}`;
const payer = `0x${"33".repeat(20)}`;
const launchTransaction = `0x${"aa".repeat(32)}`;
const targetTransaction = `0x${"bb".repeat(32)}`;
const publicationTransaction = `0x${"cc".repeat(32)}`;

const config: AcceptanceConfig = {
  launchContractUrl: "https://fixture.invalid/.well-known/launch-contract.json",
  idempotencyKey: "phase5-acceptance-stable-key",
  expectedLaunchRecipient: launchRecipient,
  expectedTargetRecipient: targetRecipient,
  maxSpendAtomic: "20000",
  confirmations: 2,
};

const policy: AcceptancePolicy = {
  chainId: 1952,
  network: "eip155:1952",
  asset: XLAYER_TESTNET_USDT0,
  assetDecimals: 6,
  launchRecipient,
  targetRecipient,
  launchAmountAtomic: "10000",
  targetAmountAtomic: "10000",
};

const completedRun: AcceptanceRun = {
  runId: "run-acceptance",
  publicationTransaction,
  launchPayment: {
    asset: XLAYER_TESTNET_USDT0,
    network: "eip155:1952",
    payer,
    recipient: launchRecipient,
    amountAtomic: "10000",
    transactionHash: launchTransaction,
  },
  targetPayment: {
    asset: XLAYER_TESTNET_USDT0,
    network: "eip155:1952",
    payer,
    recipient: targetRecipient,
    amountAtomic: "10000",
    transactionHash: targetTransaction,
  },
};

function boundary(overrides: Partial<AcceptanceBoundary> = {}): AcceptanceBoundary {
  return {
    inspectPolicy: vi.fn(async () => policy),
    submitPaidRehearsal: vi.fn(async () => ({ runId: completedRun.runId })),
    waitForCompletedRun: vi.fn(async () => completedRun),
    verifyTokenTransfer: vi.fn(async () => true),
    verifyRegistryPublication: vi.fn(async () => true),
    passportGate: vi.fn(async () => "ALLOW" as const),
    ...overrides,
  };
}

describe("X Layer testnet acceptance harness", () => {
  it("runs one idempotent, spend-capped attempt and verifies both transfers, publication, and ALLOW", async () => {
    const adapter = boundary();
    const report = vi.fn();
    const result = await runTestnetAcceptance(config, adapter, report);

    expect(result).toEqual({
      runId: completedRun.runId,
      maximumSpendAtomic: "20000",
      launchSettlementTransaction: launchTransaction,
      targetSettlementTransaction: targetTransaction,
      publicationTransaction,
      decision: "ALLOW",
    });
    expect(adapter.submitPaidRehearsal).toHaveBeenCalledTimes(1);
    expect(adapter.submitPaidRehearsal).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: config.idempotencyKey,
    }));
    expect(adapter.verifyTokenTransfer).toHaveBeenCalledTimes(2);
    expect(adapter.verifyTokenTransfer).toHaveBeenNthCalledWith(1, completedRun.launchPayment, 2);
    expect(adapter.verifyTokenTransfer).toHaveBeenNthCalledWith(2, completedRun.targetPayment, 2);
    expect(report).toHaveBeenCalledWith("Maximum test USD₮0 spend: 20000 atomic units (0.02 USD₮0)");
  });

  it.each([
    [{ chainId: 1 }, /chain 1952/],
    [{ network: "eip155:1" }, /chain 1952/],
    [{ asset: `0x${"99".repeat(20)}` }, /unknown testnet asset/],
    [{ launchRecipient: `0x${"44".repeat(20)}` }, /unknown LaunchProof recipient/],
    [{ targetRecipient: `0x${"55".repeat(20)}` }, /unknown provider recipient/],
  ])("refuses unsafe policy anchor %o before signing", async (change, message) => {
    const adapter = boundary({ inspectPolicy: vi.fn(async () => ({ ...policy, ...change })) });
    await expect(runTestnetAcceptance(config, adapter)).rejects.toThrow(message as RegExp);
    expect(adapter.submitPaidRehearsal).not.toHaveBeenCalled();
  });

  it("refuses a run whose maximum spend exceeds the explicit cap before signing", async () => {
    const adapter = boundary();
    await expect(runTestnetAcceptance({ ...config, maxSpendAtomic: "19999" }, adapter)).rejects.toThrow(/exceeds/);
    expect(adapter.submitPaidRehearsal).not.toHaveBeenCalled();
  });

  it("never retries an ambiguous paid request", async () => {
    const submit = vi.fn(async () => {
      throw new AmbiguousAcceptancePaymentError();
    });
    const adapter = boundary({ submitPaidRehearsal: submit });
    await expect(runTestnetAcceptance(config, adapter)).rejects.toBeInstanceOf(AmbiguousAcceptancePaymentError);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(adapter.waitForCompletedRun).not.toHaveBeenCalled();
  });

  it("fails closed unless both independent transfer checks, registry proof, and PassportGate are valid", async () => {
    const firstTransferOnly = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(runTestnetAcceptance(config, boundary({ verifyTokenTransfer: firstTransferOnly })))
      .rejects.toThrow(/Provider token transfer/);
    await expect(runTestnetAcceptance(config, boundary({ verifyRegistryPublication: vi.fn(async () => false) })))
      .rejects.toThrow(/Registry publication/);
    await expect(runTestnetAcceptance(config, boundary({ passportGate: vi.fn(async () => "WARN") })))
      .rejects.toThrow(/requires ALLOW/);
  });
});
