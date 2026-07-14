import { randomUUID } from "node:crypto";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import {
  decodePaymentResponseHeader,
  wrapFetchWithPaymentFromConfig,
  type PaymentPolicy,
} from "@okxweb3/x402-fetch";
import type { Config } from "../config.js";
import { NETWORK, USDT0_ADDRESS } from "../config.js";
import type { LaunchContract } from "../launch-contract/schema.js";
import type { PaymentReference } from "../domain/types.js";
import { safeRequest } from "../security/safe-fetch.js";
import type { Repository } from "../db/store.js";
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

  async pay(manifest: LaunchContract, runId: string): Promise<{ payment: PaymentReference; deliveryMatches: boolean }> {
    return this.paymentLock(() => this.payExclusive(manifest, runId));
  }

  private async payExclusive(manifest: LaunchContract, runId: string): Promise<{ payment: PaymentReference; deliveryMatches: boolean }> {
    const terms = manifest.payment;
    if (!terms || manifest.payment_mode !== "x402_optional") throw new Error("Target does not advertise x402");
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
    const publicClient = createPublicClient({ chain: xLayer, transport: http(this.config.XLAYER_RPC_URL) });
    const signer = toClientEvmSigner(account, publicClient);
    let challengeValidated = false;
    const signedTermsOnly: PaymentPolicy = (_version, requirements) =>
      requirements.filter((requirement) => {
        const valid =
          requirement.scheme === "exact" &&
          requirement.network === NETWORK &&
          requirement.asset.toLowerCase() === USDT0_ADDRESS &&
          requirement.payTo.toLowerCase() === terms.recipient.toLowerCase() &&
          BigInt(requirement.amount) === amount;
        challengeValidated ||= valid;
        return valid;
      });

    const boundedFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? init.body : undefined;
      const result = await safeRequest(url, this.config, {
        method: (init?.method?.toUpperCase() === "GET" ? "GET" : "POST"),
        headers: headerRecord(init?.headers),
        body,
        timeoutMs: manifest.max_latency_ms,
      });
      return new Response(result.text, { status: result.status, headers: result.headers });
    };
    const paidFetch = wrapFetchWithPaymentFromConfig(boundedFetch, {
      schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer) }],
      policies: [signedTermsOnly],
    });
    const response = await paidFetch(terms.resource_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, tool: manifest.tool, arguments: manifest.sample_input }),
    });
    if (!challengeValidated) throw new Error("Target x402 challenge did not match signed terms");
    const receiptHeader = response.headers.get("payment-response");
    if (!receiptHeader) throw new Error("Paid target omitted PAYMENT-RESPONSE receipt");
    const receipt = decodePaymentResponseHeader(receiptHeader) as Record<string, unknown>;
    const transaction = String(receipt.transaction ?? receipt.txHash ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(transaction)) throw new Error("Target receipt omitted settlement transaction");
    const payment: PaymentReference = {
      payment_id: String(receipt.paymentId ?? randomUUID()),
      kind: "target",
      amount: terms.amount,
      asset: terms.asset,
      network: terms.network,
      payer: account.address,
      recipient: terms.recipient,
      route: terms.resource_url,
      settlement_transaction: transaction,
      status: "settled",
      timestamp: new Date().toISOString(),
    };
    await this.repository.savePayment(payment, runId);
    if (!response.ok) return { payment, deliveryMatches: false };
    try {
      const result = (await response.json()) as { run_id?: unknown; source_revision?: unknown };
      return {
        payment,
        deliveryMatches: result.run_id === runId && result.source_revision === manifest.source_revision,
      };
    } catch {
      return { payment, deliveryMatches: false };
    }
  }
}
