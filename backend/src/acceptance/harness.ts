export const XLAYER_TESTNET_CHAIN_ID = 1952 as const;
export const XLAYER_TESTNET_NETWORK = "eip155:1952" as const;
export const XLAYER_TESTNET_USDT0 = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c" as const;

const address = /^0x[0-9a-fA-F]{40}$/;
const transactionHash = /^0x[0-9a-fA-F]{64}$/;

export interface AcceptancePolicy {
  chainId: number;
  network: string;
  asset: string;
  assetDecimals: number;
  launchRecipient: string;
  targetRecipient: string;
  launchAmountAtomic: string;
  targetAmountAtomic: string;
}

export interface AcceptanceConfig {
  launchContractUrl: string;
  idempotencyKey: string;
  expectedLaunchRecipient: string;
  expectedTargetRecipient: string;
  maxSpendAtomic: string;
  confirmations: number;
}

export interface AcceptancePayment {
  asset: string;
  network: string;
  payer: string;
  recipient: string;
  amountAtomic: string;
  transactionHash: string;
}

export interface AcceptanceRun {
  runId: string;
  publicationTransaction: string;
  launchPayment: AcceptancePayment;
  targetPayment: AcceptancePayment;
}

export interface AcceptanceBoundary {
  inspectPolicy(launchContractUrl: string): Promise<AcceptancePolicy>;
  submitPaidRehearsal(input: {
    launchContractUrl: string;
    idempotencyKey: string;
    expectedPolicy: AcceptancePolicy;
  }): Promise<{ runId: string }>;
  waitForCompletedRun(runId: string): Promise<AcceptanceRun>;
  verifyTokenTransfer(payment: AcceptancePayment, confirmations: number): Promise<boolean>;
  verifyRegistryPublication(run: AcceptanceRun, confirmations: number): Promise<boolean>;
  passportGate(launchContractUrl: string): Promise<"ALLOW" | "WARN" | "BLOCK" | "REHEARSAL_REQUIRED">;
}

export interface AcceptanceResult {
  runId: string;
  maximumSpendAtomic: string;
  launchSettlementTransaction: string;
  targetSettlementTransaction: string;
  publicationTransaction: string;
  decision: "ALLOW";
}

/** A signed payment may have reached the facilitator even when its HTTP result is lost. */
export class AmbiguousAcceptancePaymentError extends Error {
  constructor(message = "The paid request outcome is ambiguous; automatic retry is forbidden") {
    super(message);
    this.name = "AmbiguousAcceptancePaymentError";
  }
}

/**
 * Orchestrates one and only one paid attempt. The boundary owns signing and RPC
 * access; this function never receives, logs, serializes, or persists a payer key.
 */
export async function runTestnetAcceptance(
  config: AcceptanceConfig,
  boundary: AcceptanceBoundary,
  report: (message: string) => void = () => undefined,
): Promise<AcceptanceResult> {
  validateConfig(config);
  const policy = await boundary.inspectPolicy(config.launchContractUrl);
  validatePolicy(policy, config);

  const maximumSpend = BigInt(policy.launchAmountAtomic) + BigInt(policy.targetAmountAtomic);
  if (maximumSpend > BigInt(config.maxSpendAtomic)) {
    throw new Error(`Acceptance spend ${maximumSpend} atomic units exceeds the configured per-run cap`);
  }
  report(`Maximum test USD₮0 spend: ${maximumSpend} atomic units (${formatAtomic(maximumSpend, policy.assetDecimals)} USD₮0)`);

  // Deliberately no retry loop: an exception after authorization creation is
  // ambiguous and must be reconciled by the operator using the same key.
  const submitted = await boundary.submitPaidRehearsal({
    launchContractUrl: config.launchContractUrl,
    idempotencyKey: config.idempotencyKey,
    expectedPolicy: policy,
  });
  if (!submitted.runId) throw new Error("Paid rehearsal did not return a run ID");

  const run = await boundary.waitForCompletedRun(submitted.runId);
  if (run.runId !== submitted.runId) throw new Error("Completed run does not match the submitted run ID");
  validatePayment(run.launchPayment, policy, "launch");
  validatePayment(run.targetPayment, policy, "target");
  if (!transactionHash.test(run.publicationTransaction)) throw new Error("Registry publication transaction is invalid");

  if (!await boundary.verifyTokenTransfer(run.launchPayment, config.confirmations)) {
    throw new Error("Inbound LaunchProof token transfer could not be independently verified");
  }
  if (!await boundary.verifyTokenTransfer(run.targetPayment, config.confirmations)) {
    throw new Error("Provider token transfer could not be independently verified");
  }
  if (!await boundary.verifyRegistryPublication(run, config.confirmations)) {
    throw new Error("Registry publication could not be independently verified");
  }
  const decision = await boundary.passportGate(config.launchContractUrl);
  if (decision !== "ALLOW") throw new Error(`PassportGate acceptance requires ALLOW, received ${decision}`);

  return {
    runId: run.runId,
    maximumSpendAtomic: maximumSpend.toString(),
    launchSettlementTransaction: run.launchPayment.transactionHash,
    targetSettlementTransaction: run.targetPayment.transactionHash,
    publicationTransaction: run.publicationTransaction,
    decision,
  };
}

function validateConfig(config: AcceptanceConfig): void {
  const url = new URL(config.launchContractUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Acceptance target must be a credential-free HTTPS URL");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(config.idempotencyKey)) throw new Error("A stable, non-secret idempotency key is required");
  if (!address.test(config.expectedLaunchRecipient) || isZeroAddress(config.expectedLaunchRecipient)) throw new Error("Trusted launch recipient is invalid");
  if (!address.test(config.expectedTargetRecipient) || isZeroAddress(config.expectedTargetRecipient)) throw new Error("Trusted target recipient is invalid");
  if (!/^\d+$/.test(config.maxSpendAtomic) || BigInt(config.maxSpendAtomic) <= 0n) throw new Error("Acceptance spend cap must be positive atomic units");
  if (!Number.isInteger(config.confirmations) || config.confirmations < 1 || config.confirmations > 64) throw new Error("Acceptance confirmations must be between 1 and 64");
}

function validatePolicy(policy: AcceptancePolicy, config: AcceptanceConfig): void {
  if (policy.chainId !== XLAYER_TESTNET_CHAIN_ID || policy.network !== XLAYER_TESTNET_NETWORK) {
    throw new Error("Acceptance is permanently locked to X Layer testnet chain 1952");
  }
  if (policy.asset.toLowerCase() !== XLAYER_TESTNET_USDT0 || policy.assetDecimals !== 6) {
    throw new Error("Acceptance refused an unknown testnet asset");
  }
  if (!equalAddress(policy.launchRecipient, config.expectedLaunchRecipient)) throw new Error("Acceptance refused an unknown LaunchProof recipient");
  if (!equalAddress(policy.targetRecipient, config.expectedTargetRecipient)) throw new Error("Acceptance refused an unknown provider recipient");
  for (const amount of [policy.launchAmountAtomic, policy.targetAmountAtomic]) {
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error("Acceptance payment amount must be positive atomic units");
  }
}

function validatePayment(payment: AcceptancePayment, policy: AcceptancePolicy, kind: "launch" | "target"): void {
  const expectedRecipient = kind === "launch" ? policy.launchRecipient : policy.targetRecipient;
  const expectedAmount = kind === "launch" ? policy.launchAmountAtomic : policy.targetAmountAtomic;
  if (payment.network !== XLAYER_TESTNET_NETWORK || payment.asset.toLowerCase() !== XLAYER_TESTNET_USDT0) {
    throw new Error(`${kind} payment used an unknown chain or asset`);
  }
  if (!address.test(payment.payer) || isZeroAddress(payment.payer)) throw new Error(`${kind} payment payer is invalid`);
  if (!equalAddress(payment.recipient, expectedRecipient) || payment.amountAtomic !== expectedAmount) {
    throw new Error(`${kind} payment does not match the inspected immutable policy`);
  }
  if (!transactionHash.test(payment.transactionHash)) throw new Error(`${kind} settlement transaction is invalid`);
}

function equalAddress(left: string, right: string): boolean {
  return address.test(left) && address.test(right) && left.toLowerCase() === right.toLowerCase();
}

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === `0x${"0".repeat(40)}`;
}

function formatAtomic(value: bigint, decimals: number): string {
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
