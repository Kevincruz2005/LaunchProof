import { randomUUID } from "node:crypto";
import { createPublicClient, decodeEventLog, fallback, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import { wrapFetchWithPayment, x402Client, type PaymentPolicy } from "@okxweb3/x402-fetch";
import { LaunchContractSchema } from "../launch-contract/schema.js";
import {
  AmbiguousAcceptancePaymentError,
  runTestnetAcceptance,
  XLAYER_TESTNET_CHAIN_ID,
  XLAYER_TESTNET_NETWORK,
  XLAYER_TESTNET_USDT0,
  type AcceptanceBoundary,
  type AcceptancePayment,
  type AcceptancePolicy,
  type AcceptanceRun,
} from "./harness.js";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const address = /^0x[0-9a-fA-F]{40}$/;
const privateKey = /^0x[0-9a-fA-F]{64}$/;

interface PublicCard {
  chain: { id: number; network: string; testnet: boolean; rpc_url: string; registry_address: string | null; usdt0_address: string; usdt0_decimals: number };
  payments: { x402_enabled: boolean; payment_ready: boolean; pay_to: string | null; genesis_amount_atomic: string; asset: { address: string; decimals: number } };
}

interface CompletedApiRun {
  run_id: string;
  state: string;
  payment: ApiPayment;
  target_payment: ApiPayment | null;
  chain: { published: boolean; evidence_transaction_hash: string };
}

interface ApiPayment {
  asset: string;
  network: string;
  payer: string | null;
  recipient: string | null;
  amount_atomic: string;
  settlement_transaction: string | null;
  status: string;
}

export class RealTestnetAcceptanceBoundary implements AcceptanceBoundary {
  private policy: AcceptancePolicy | null = null;
  private readonly publicClient;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly rpcUrl: string,
    private readonly fallbackRpcUrl: string | undefined,
    private readonly payerPrivateKey: `0x${string}`,
  ) {
    const transports = [http(rpcUrl), ...(fallbackRpcUrl ? [http(fallbackRpcUrl)] : [])];
    this.publicClient = createPublicClient({
      chain: xLayerTestnet,
      transport: transports.length > 1 ? fallback(transports) : transports[0]!,
    });
  }

  async inspectPolicy(launchContractUrl: string): Promise<AcceptancePolicy> {
    const [cardResponse, contractResponse, rpcChainId] = await Promise.all([
      fetch(`${this.apiBaseUrl}/.well-known/launchproof.json`, { headers: { accept: "application/json" } }),
      fetch(launchContractUrl, { headers: { accept: "application/json" } }),
      this.publicClient.getChainId(),
    ]);
    if (!cardResponse.ok || !contractResponse.ok) throw new Error("Acceptance could not inspect the public project and Launch Contract policies");
    const card = await cardResponse.json() as PublicCard;
    const manifest = LaunchContractSchema.parse(await contractResponse.json());
    if (rpcChainId !== XLAYER_TESTNET_CHAIN_ID || card.chain.id !== XLAYER_TESTNET_CHAIN_ID || !card.chain.testnet) {
      throw new Error("Acceptance RPC and deployment must both identify X Layer testnet chain 1952");
    }
    if (!card.chain.registry_address || !card.payments.x402_enabled || !card.payments.payment_ready || !card.payments.pay_to) {
      throw new Error("Acceptance requires a startup-verified x402 deployment");
    }
    if (!manifest.payment) throw new Error("Acceptance fixture does not declare target x402 terms");
    if (manifest.payment.network !== XLAYER_TESTNET_NETWORK || manifest.payment.asset.toLowerCase() !== XLAYER_TESTNET_USDT0) {
      throw new Error("Acceptance fixture advertises an unknown payment chain or asset");
    }
    if (card.chain.usdt0_address.toLowerCase() !== card.payments.asset.address.toLowerCase()) {
      throw new Error("Project card publishes inconsistent asset anchors");
    }
    this.policy = {
      chainId: card.chain.id,
      network: card.chain.network,
      asset: card.payments.asset.address,
      assetDecimals: card.payments.asset.decimals,
      launchRecipient: card.payments.pay_to,
      targetRecipient: manifest.payment.recipient,
      launchAmountAtomic: card.payments.genesis_amount_atomic,
      targetAmountAtomic: manifest.payment.amount,
    };
    return this.policy;
  }

  async submitPaidRehearsal(input: {
    launchContractUrl: string;
    idempotencyKey: string;
    expectedPolicy: AcceptancePolicy;
  }): Promise<{ runId: string }> {
    if (!this.policy || JSON.stringify(this.policy) !== JSON.stringify(input.expectedPolicy)) {
      throw new Error("Acceptance policy changed after inspection");
    }
    const account = privateKeyToAccount(this.payerPrivateKey);
    const signer = toClientEvmSigner(account, this.publicClient);
    let authorizationCreated = false;
    const exactPolicy: PaymentPolicy = (_version, requirements) => requirements.filter((requirement) =>
      requirement.scheme === "exact" &&
      requirement.network === XLAYER_TESTNET_NETWORK &&
      requirement.asset.toLowerCase() === XLAYER_TESTNET_USDT0 &&
      requirement.payTo.toLowerCase() === input.expectedPolicy.launchRecipient.toLowerCase() &&
      BigInt(requirement.amount) === BigInt(input.expectedPolicy.launchAmountAtomic)
    );
    const paymentClient = new x402Client()
      .register(XLAYER_TESTNET_NETWORK, new ExactEvmScheme(signer))
      .registerPolicy(exactPolicy)
      .onAfterPaymentCreation(async () => {
        authorizationCreated = true;
        if (await this.publicClient.getChainId() !== XLAYER_TESTNET_CHAIN_ID) {
          throw new Error("Payment signing refused because RPC is not X Layer testnet");
        }
      });
    const paidFetch = wrapFetchWithPayment(fetch, paymentClient);
    let response: Response;
    try {
      response = await paidFetch(`${this.apiBaseUrl}/api/rehearsals`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ url: input.launchContractUrl, idempotency_key: input.idempotencyKey }),
      });
    } catch (cause) {
      if (authorizationCreated) throw new AmbiguousAcceptancePaymentError();
      throw cause;
    }
    if (!response.ok) {
      if (authorizationCreated) throw new AmbiguousAcceptancePaymentError(`Paid request returned HTTP ${response.status}; reconcile before any retry`);
      throw new Error(`Acceptance rehearsal was refused before signing (HTTP ${response.status})`);
    }
    let body: { run_id?: unknown };
    try {
      body = await response.json() as { run_id?: unknown };
    } catch {
      throw new AmbiguousAcceptancePaymentError("Paid request returned an unreadable success response; reconcile before any retry");
    }
    if (typeof body.run_id !== "string" || !body.run_id) throw new AmbiguousAcceptancePaymentError("Paid request succeeded without a run ID; reconcile before any retry");
    return { runId: body.run_id };
  }

  async waitForCompletedRun(runId: string): Promise<AcceptanceRun> {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${this.apiBaseUrl}/runs/${encodeURIComponent(runId)}`, { headers: { accept: "application/json" } });
      if (response.ok) {
        const run = await response.json() as CompletedApiRun;
        if (run.state === "complete") return acceptanceRun(run);
        if (run.state === "failed") throw new Error("Acceptance rehearsal failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error("Acceptance rehearsal did not complete before the five-minute deadline");
  }

  async verifyTokenTransfer(payment: AcceptancePayment, confirmations: number): Promise<boolean> {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: payment.transactionHash as `0x${string}`,
      confirmations,
      timeout: 120_000,
    });
    if (receipt.status !== "success") return false;
    return receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== payment.asset.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi: [transferEvent], data: log.data, topics: log.topics, strict: true });
        return decoded.args.from.toLowerCase() === payment.payer.toLowerCase() &&
          decoded.args.to.toLowerCase() === payment.recipient.toLowerCase() &&
          decoded.args.value === BigInt(payment.amountAtomic);
      } catch {
        return false;
      }
    });
  }

  async verifyRegistryPublication(run: AcceptanceRun, confirmations: number): Promise<boolean> {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: run.publicationTransaction as `0x${string}`,
      confirmations,
      timeout: 120_000,
    });
    if (receipt.status !== "success") return false;
    const response = await fetch(`${this.apiBaseUrl}/verify/${encodeURIComponent(run.runId)}`, { headers: { accept: "application/json" } });
    if (!response.ok) return false;
    const verification = await response.json() as {
      match?: unknown;
      transaction_hash?: unknown;
      launch_payment_transfer_match?: unknown;
      target_payment_transfer_match?: unknown;
      registry_runtime_match?: unknown;
    };
    return verification.match === true &&
      verification.registry_runtime_match === true &&
      verification.launch_payment_transfer_match === true &&
      verification.target_payment_transfer_match === true &&
      typeof verification.transaction_hash === "string" &&
      verification.transaction_hash.toLowerCase() === run.publicationTransaction.toLowerCase();
  }

  async passportGate(launchContractUrl: string): Promise<"ALLOW" | "WARN" | "BLOCK" | "REHEARSAL_REQUIRED"> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/passport-gate/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launch_contract_url: launchContractUrl }),
    });
    if (!response.ok) throw new Error(`PassportGate acceptance check failed (HTTP ${response.status})`);
    const body = await response.json() as { decision?: unknown };
    if (!new Set(["ALLOW", "WARN", "BLOCK", "REHEARSAL_REQUIRED"]).has(String(body.decision))) {
      throw new Error("PassportGate returned an invalid decision");
    }
    return body.decision as "ALLOW" | "WARN" | "BLOCK" | "REHEARSAL_REQUIRED";
  }
}

function acceptanceRun(run: CompletedApiRun): AcceptanceRun {
  if (!run.chain?.published || !run.target_payment) throw new Error("Completed run omitted paid publication evidence");
  return {
    runId: run.run_id,
    publicationTransaction: run.chain.evidence_transaction_hash,
    launchPayment: acceptancePayment(run.payment),
    targetPayment: acceptancePayment(run.target_payment),
  };
}

function acceptancePayment(payment: ApiPayment): AcceptancePayment {
  if (payment.status !== "settled" || !payment.payer || !payment.recipient || !payment.settlement_transaction) {
    throw new Error("Acceptance run contains an unverified payment reference");
  }
  return {
    asset: payment.asset,
    network: payment.network,
    payer: payment.payer,
    recipient: payment.recipient,
    amountAtomic: payment.amount_atomic,
    transactionHash: payment.settlement_transaction,
  };
}

async function main(): Promise<void> {
  if (process.env.ACCEPTANCE_EXECUTE !== "xlayer-testnet-1952-explicit") {
    throw new Error("Live acceptance is disabled; set ACCEPTANCE_EXECUTE=xlayer-testnet-1952-explicit only during an approved testnet run");
  }
  const apiBase = requiredUrl("ACCEPTANCE_API_BASE_URL");
  const launchContractUrl = requiredUrl("ACCEPTANCE_LAUNCH_CONTRACT_URL");
  const rpcUrl = requiredUrl("ACCEPTANCE_XLAYER_RPC_URL");
  const fallbackRpcUrl = optionalUrl("ACCEPTANCE_XLAYER_FALLBACK_RPC_URL");
  const secret = process.env.ACCEPTANCE_PAYER_PRIVATE_KEY;
  if (!secret || !privateKey.test(secret)) throw new Error("ACCEPTANCE_PAYER_PRIVATE_KEY must be supplied through the process environment");
  const expectedLaunchRecipient = requiredAddress("ACCEPTANCE_LAUNCH_RECIPIENT");
  const expectedTargetRecipient = requiredAddress("ACCEPTANCE_TARGET_RECIPIENT");
  const maxSpendAtomic = requiredAtomic("ACCEPTANCE_MAX_SPEND_ATOMIC");
  const idempotencyKey = process.env.ACCEPTANCE_IDEMPOTENCY_KEY?.trim() || `acceptance-${randomUUID()}`;
  const confirmations = Number(process.env.ACCEPTANCE_CONFIRMATIONS ?? "2");

  const result = await runTestnetAcceptance({
    launchContractUrl,
    idempotencyKey,
    expectedLaunchRecipient,
    expectedTargetRecipient,
    maxSpendAtomic,
    confirmations,
  }, new RealTestnetAcceptanceBoundary(apiBase, rpcUrl, fallbackRpcUrl, secret as `0x${string}`), (message) => process.stdout.write(`${message}\n`));
  process.stdout.write(`${JSON.stringify({ event: "testnet_acceptance_passed", ...result })}\n`);
}

function requiredUrl(name: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} is required`);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`${name} must be a credential-free HTTPS URL`);
  return url.toString().replace(/\/$/, "");
}

function optionalUrl(name: string): string | undefined {
  return process.env[name]?.trim() ? requiredUrl(name) : undefined;
}

function requiredAddress(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !address.test(value) || value.toLowerCase() === `0x${"0".repeat(40)}`) throw new Error(`${name} must be a nonzero EVM address`);
  return value;
}

function requiredAtomic(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${name} must be positive atomic units`);
  return value;
}

void main().catch((error: unknown) => {
  // Only the error class/message is emitted. Environment values, request
  // headers, signed payloads, and the payer key are never serialized.
  process.stderr.write(`${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Acceptance failed";
  return message
    .replace(/0x[0-9a-fA-F]{64}/g, "[redacted-64-byte-value]")
    .replace(/(payment-signature|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}
