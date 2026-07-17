import { createPublicClient, decodeEventLog, fallback, formatUnits, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import {
  decodePaymentResponseHeader,
  wrapFetchWithPayment,
  x402Client,
  type PaymentPayload,
  type PaymentPolicy,
} from "@okxweb3/x402-fetch";
import type { Config } from "../config.js";
import type { LaunchContract } from "../launch-contract/schema.js";
import type { FieldComparison, InvocationEvidence, PaymentReference } from "../domain/types.js";
import { safeRequest } from "../security/safe-fetch.js";
import type { Repository, TargetPaymentAttempt } from "../db/store.js";
import pLimit from "p-limit";

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export class TargetPaymentService {
  private readonly paymentLock = pLimit(1);

  constructor(
    private readonly config: Config,
    private readonly repository: Repository,
  ) {}

  async pay(manifest: LaunchContract, runId: string): Promise<{
    payment: PaymentReference;
    deliveryMatches: boolean;
    evidence: InvocationEvidence;
  }> {
    return this.paymentLock(() => this.repository.withTargetPaymentLock(() => this.payExclusive(manifest, runId)));
  }

  private async payExclusive(manifest: LaunchContract, runId: string): Promise<{
    payment: PaymentReference;
    deliveryMatches: boolean;
    evidence: InvocationEvidence;
  }> {
    const existing = await this.repository.getTargetPaymentForRun(runId);
    if (existing) {
      return {
        payment: existing,
        deliveryMatches: false,
        evidence: failedDeliveryEvidence(runId, manifest, "A prior target settlement exists without retained delivery output"),
      };
    }
    const storedRun = await this.repository.getRun(runId);
    if (storedRun && !("canonical_evidence" in storedRun) && storedRun.target_payment_attempt) {
      throw new Error("A signed target authorization is awaiting deterministic recovery; a replacement payment is forbidden");
    }
    const terms = manifest.payment;
    if (!terms || manifest.payment_mode !== "x402_optional") throw new Error("Target does not advertise x402");
    if (!this.config.X402_ENABLED || !this.config.paymentReady) throw new Error("Target payment is disabled until the full x402 path is ready");
    if (!this.config.TARGET_PAYER_PRIVATE_KEY) throw new Error("Target payer wallet is not configured");
    const resource = new URL(terms.resource_url);
    if (!this.config.targetAllowlist.has(resource.hostname.toLowerCase())) {
      throw new Error("Target payment refused: hostname is not allowlisted");
    }
    const amount = BigInt(terms.amount);
    const perRunCap = BigInt(Math.round(this.config.TARGET_PAYMENT_MAX_USDT0 * 1_000_000));
    const dailyCap = BigInt(Math.round(this.config.TARGET_PAYMENT_DAILY_LIMIT_USDT0 * 1_000_000));
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const spentAtomic = await this.repository.targetSpendSince(dayStart);
    if (amount > perRunCap || spentAtomic + amount > dailyCap) throw new Error("Target payment budget exceeded");

    const account = privateKeyToAccount(this.config.TARGET_PAYER_PRIVATE_KEY as `0x${string}`);
    if (!this.config.XLAYER_RPC_URL) throw new Error("Target payment RPC is not configured");
    const transports = [http(this.config.XLAYER_RPC_URL), ...(this.config.XLAYER_FALLBACK_RPC_URL ? [http(this.config.XLAYER_FALLBACK_RPC_URL)] : [])];
    const publicClient = createPublicClient({
      chain: xLayerTestnet,
      transport: transports.length > 1 ? fallback(transports) : transports[0]!,
    });
    const signer = toClientEvmSigner(account, publicClient);
    let challengeValidated = false;
    const signedTermsOnly: PaymentPolicy = (_version, requirements) =>
      requirements.filter((requirement) => {
        const valid =
          requirement.scheme === "exact" &&
          requirement.network === this.config.chain.network &&
          requirement.asset.toLowerCase() === this.config.chain.usdt0Address.toLowerCase() &&
          requirement.payTo.toLowerCase() === terms.recipient.toLowerCase() &&
          BigInt(requirement.amount) === amount;
        challengeValidated ||= valid;
        return valid;
      });

    const startBlock = await publicClient.getBlockNumber();
    const boundedFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? init.body : undefined;
      const headers = new Headers(init?.headers);
      if (headers.has("payment-signature")) {
        const rpcChainId = await publicClient.getChainId();
        if (rpcChainId !== 1952 || rpcChainId !== this.config.chain.id) {
          throw new Error(`Target payment refused: RPC returned chain ${rpcChainId}, expected 1952`);
        }
      }
      const result = await safeRequest(url, this.config, {
        method: (init?.method?.toUpperCase() === "GET" ? "GET" : "POST"),
        headers: headerRecord(headers),
        body,
        timeoutMs: manifest.max_latency_ms,
      });
      return new Response(result.text, { status: result.status, headers: result.headers });
    };
    const paymentClient = new x402Client()
      .register(this.config.chain.network, new ExactEvmScheme(signer))
      .registerPolicy(signedTermsOnly)
      .onAfterPaymentCreation(async ({ paymentPayload }) => {
        const authorization = readEip3009Authorization(paymentPayload);
        if (
          paymentPayload.accepted.network !== this.config.chain.network ||
          paymentPayload.accepted.asset.toLowerCase() !== this.config.chain.usdt0Address.toLowerCase() ||
          paymentPayload.accepted.payTo.toLowerCase() !== terms.recipient.toLowerCase() ||
          BigInt(paymentPayload.accepted.amount) !== amount ||
          authorization.from.toLowerCase() !== account.address.toLowerCase() ||
          authorization.to.toLowerCase() !== terms.recipient.toLowerCase() ||
          BigInt(authorization.value) !== amount
        ) throw new Error("Signed target authorization does not match the immutable manifest terms");
        await this.repository.recordTargetPaymentAttempt(runId, {
          asset: terms.asset,
          network: terms.network,
          payer: account.address,
          recipient: terms.recipient,
          amount_atomic: terms.amount,
          route: terms.resource_url,
          source_revision: manifest.source_revision,
          authorization_nonce: authorization.nonce,
          authorization_valid_before: authorization.validBefore,
          start_block: startBlock.toString(),
          created_at: new Date().toISOString(),
          transaction_hash: null,
          payment_payload: JSON.parse(JSON.stringify(paymentPayload)) as Record<string, unknown>,
        });
      });
    const paidFetch = wrapFetchWithPayment(boundedFetch, paymentClient);
    const deliveryStarted = performance.now();
    const response = await paidFetch(terms.resource_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, tool: manifest.tool, arguments: manifest.sample_input }),
    });
    if (!challengeValidated) throw new Error("Target x402 challenge did not match signed terms");
    const receiptHeader = response.headers.get("payment-response");
    if (!receiptHeader) throw new Error("Paid target omitted PAYMENT-RESPONSE receipt");
    const receipt = decodePaymentResponseHeader(receiptHeader);
    if (!receipt.success || (receipt.status && receipt.status !== "success")) throw new Error("Target x402 settlement is not final");
    if (receipt.network !== this.config.chain.network) throw new Error("Target receipt used the wrong network");
    if (receipt.amount !== undefined && BigInt(receipt.amount) !== amount) throw new Error("Target receipt amount does not match signed terms");
    const transaction = receipt.transaction;
    if (!/^0x[0-9a-fA-F]{64}$/.test(transaction)) throw new Error("Target receipt omitted settlement transaction");
    if (!receipt.payer || !/^0x[0-9a-fA-F]{40}$/.test(receipt.payer) ||
      receipt.payer.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error("Target receipt payer does not match the configured target payer");
    }
    await this.repository.recordTargetPaymentTransaction(runId, transaction);
    const progress = await this.repository.getRun(runId);
    const authorizationNonce = progress && !("canonical_evidence" in progress)
      ? progress.target_payment_attempt?.authorization_nonce
      : undefined;
    const settledAt = await verifyTargetTransfer(
      publicClient,
      transaction as `0x${string}`,
      this.config.chain.usdt0Address,
      terms.recipient as `0x${string}`,
      account.address,
      amount,
      authorizationNonce,
    );
    const payment: PaymentReference = {
      payment_id: transaction,
      kind: "target",
      amount: terms.amount,
      amount_atomic: terms.amount,
      amount_display: formatUnits(amount, this.config.chain.usdt0Decimals),
      asset_decimals: this.config.chain.usdt0Decimals,
      asset: terms.asset,
      network: terms.network,
      payer: account.address,
      recipient: terms.recipient,
      route: terms.resource_url,
      settlement_transaction: transaction,
      status: "settled",
      timestamp: settledAt,
    };
    await this.repository.savePayment(payment, runId);
    const latencyMs = Math.round(performance.now() - deliveryStarted);
    if (!response.ok) {
      return {
        payment,
        deliveryMatches: false,
        evidence: failedDeliveryEvidence(runId, manifest, `Paid target returned HTTP ${response.status}`, latencyMs),
      };
    }
    try {
      const result = (await response.json()) as { run_id?: unknown; source_revision?: unknown };
      const output = {
        run_id: typeof result.run_id === "string" ? result.run_id : null,
        source_revision: typeof result.source_revision === "string" ? result.source_revision : null,
      };
      const comparisons: FieldComparison[] = [
        deliveryComparison("run_id", runId, output.run_id),
        deliveryComparison("source_revision", manifest.source_revision, output.source_revision),
      ];
      const deliveryMatches = comparisons.every((comparison) => comparison.match);
      return {
        payment,
        deliveryMatches,
        evidence: {
          kind: "paid_delivery",
          index: 0,
          input: { run_id: runId, tool: manifest.tool },
          expected: { run_id: runId, source_revision: manifest.source_revision },
          output,
          comparisons,
          structured_error: null,
          latency_ms: latencyMs,
          classification: deliveryMatches
            ? null
            : comparisons.some((comparison) => comparison.classification === "schema_drift")
              ? "schema_drift"
              : "invalid_output",
        },
      };
    } catch {
      return {
        payment,
        deliveryMatches: false,
        evidence: failedDeliveryEvidence(runId, manifest, "Paid target response was not JSON", latencyMs),
      };
    }
  }
}

function readEip3009Authorization(paymentPayload: PaymentPayload): {
  from: string;
  to: string;
  value: string;
  validBefore: string;
  nonce: string;
} {
  const raw = paymentPayload.payload.authorization;
  const signature = paymentPayload.payload.signature;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof signature !== "string") {
    throw new Error("Target asset did not produce a signed EIP-3009 authorization");
  }
  const authorization = raw as Record<string, unknown>;
  const result = {
    from: authorization.from,
    to: authorization.to,
    value: authorization.value,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce,
  };
  if (
    typeof result.from !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(result.from) ||
    typeof result.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(result.to) ||
    typeof result.value !== "string" || !/^\d+$/.test(result.value) ||
    typeof result.validBefore !== "string" || !/^\d+$/.test(result.validBefore) ||
    typeof result.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result.nonce) ||
    !/^0x[0-9a-fA-F]+$/.test(signature)
  ) throw new Error("Target EIP-3009 authorization is malformed");
  return result as { from: string; to: string; value: string; validBefore: string; nonce: string };
}

function deliveryComparison(field: string, expected: string, actual: string | null): FieldComparison {
  const match = actual === expected;
  return {
    field,
    expected,
    actual,
    match,
    classification: match ? null : actual === null ? "schema_drift" : "invalid_output",
  };
}

function failedDeliveryEvidence(
  runId: string,
  manifest: LaunchContract,
  message: string,
  latencyMs = 0,
): InvocationEvidence {
  return {
    kind: "paid_delivery",
    index: 0,
    input: { run_id: runId, tool: manifest.tool },
    expected: { run_id: runId, source_revision: manifest.source_revision },
    output: null,
    comparisons: [],
    structured_error: { code: "PAID_DELIVERY_ERROR", message },
    latency_ms: latencyMs,
    classification: "invalid_output",
  };
}

const transferEvent = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

const authorizationUsedEvent = [{
  type: "event",
  name: "AuthorizationUsed",
  inputs: [
    { name: "authorizer", type: "address", indexed: true },
    { name: "nonce", type: "bytes32", indexed: true },
  ],
}] as const;

/** Recover an x402 settlement from the persisted signed EIP-3009 nonce without ever signing a replacement. */
export async function reconcilePendingTargetPayments(config: Config, repository: Repository): Promise<number> {
  if (!config.XLAYER_RPC_URL) return 0;
  const transports = [http(config.XLAYER_RPC_URL), ...(config.XLAYER_FALLBACK_RPC_URL ? [http(config.XLAYER_FALLBACK_RPC_URL)] : [])];
  const client = createPublicClient({
    chain: xLayerTestnet,
    transport: transports.length > 1 ? fallback(transports) : transports[0]!,
  });
  let reconciled = 0;
  for (const run of await repository.pendingTargetPaymentAttempts()) {
    const attempt = run.target_payment_attempt;
    if (!attempt) continue;
    let transaction = attempt.transaction_hash;
    if (!transaction) {
      transaction = await findAuthorizationTransaction(client, attempt, config.chain.usdt0Address);
      if (transaction) await repository.recordTargetPaymentTransaction(run.run_id, transaction);
    }
    if (!transaction) {
      const latest = await client.getBlock();
      if (latest.timestamp > BigInt(attempt.authorization_valid_before)) {
        await repository.clearTargetPaymentAttempt(run.run_id);
      }
      continue;
    }
    try {
      const settledAt = await verifyTargetTransfer(
        client,
        transaction as `0x${string}`,
        config.chain.usdt0Address,
        attempt.recipient as `0x${string}`,
        attempt.payer,
        BigInt(attempt.amount_atomic),
        attempt.authorization_nonce,
      );
      await repository.savePayment(paymentFromAttempt(attempt, transaction, settledAt, config), run.run_id);
      reconciled += 1;
    } catch {
      // A pending receipt or temporarily indeterminate RPC result remains recoverable on the next restart.
    }
  }
  return reconciled;
}

async function findAuthorizationTransaction(
  client: PublicClient,
  attempt: TargetPaymentAttempt,
  asset: `0x${string}`,
): Promise<string | null> {
  const latest = await client.getBlockNumber();
  const start = BigInt(attempt.start_block);
  if (start > latest) return null;
  const chunkSize = 500n;
  for (let fromBlock = start; fromBlock <= latest; fromBlock += chunkSize) {
    const toBlock = fromBlock + chunkSize - 1n > latest ? latest : fromBlock + chunkSize - 1n;
    const logs = await client.getLogs({
      address: asset,
      event: authorizationUsedEvent[0],
      args: {
        authorizer: attempt.payer as `0x${string}`,
        nonce: attempt.authorization_nonce as `0x${string}`,
      },
      fromBlock,
      toBlock,
      strict: true,
    });
    const transaction = logs.find((log) => Boolean(log.transactionHash))?.transactionHash;
    if (transaction) return transaction;
  }
  return null;
}

function paymentFromAttempt(
  attempt: TargetPaymentAttempt,
  transaction: string,
  settledAt: string,
  config: Config,
): PaymentReference {
  return {
    payment_id: transaction,
    kind: "target",
    amount: attempt.amount_atomic,
    amount_atomic: attempt.amount_atomic,
    amount_display: formatUnits(BigInt(attempt.amount_atomic), config.chain.usdt0Decimals),
    asset_decimals: config.chain.usdt0Decimals,
    asset: attempt.asset,
    network: attempt.network,
    payer: attempt.payer,
    recipient: attempt.recipient,
    route: attempt.route,
    settlement_transaction: transaction,
    status: "settled",
    timestamp: settledAt,
  };
}

async function verifyTargetTransfer(
  client: PublicClient,
  transaction: `0x${string}`,
  asset: `0x${string}`,
  recipient: `0x${string}`,
  payer: string,
  amount: bigint,
  authorizationNonce?: string,
): Promise<string> {
  const receipt = await client.waitForTransactionReceipt({ hash: transaction, confirmations: 2, timeout: 15_000 });
  if (receipt.status !== "success") throw new Error("Target settlement transaction reverted");
  const transferMatches = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== asset.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: transferEvent, data: log.data, topics: log.topics, strict: true });
      const args = decoded.args as { from: string; to: string; value: bigint };
      return args.from.toLowerCase() === payer.toLowerCase() &&
        args.to.toLowerCase() === recipient.toLowerCase() &&
        args.value === amount;
    } catch {
      return false;
    }
  });
  if (!transferMatches) throw new Error("Target settlement does not contain the declared USD₮0 transfer");
  if (authorizationNonce) {
    const authorizationMatches = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== asset.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi: authorizationUsedEvent, data: log.data, topics: log.topics, strict: true });
        const args = decoded.args as { authorizer: string; nonce: string };
        return args.authorizer.toLowerCase() === payer.toLowerCase() &&
          args.nonce.toLowerCase() === authorizationNonce.toLowerCase();
      } catch {
        return false;
      }
    });
    if (!authorizationMatches) throw new Error("Target settlement does not consume the persisted EIP-3009 authorization");
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return new Date(Number(block.timestamp) * 1_000).toISOString();
}
