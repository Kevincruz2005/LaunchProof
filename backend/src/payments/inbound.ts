import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { createPublicClient, decodeEventLog, fallback, http } from "viem";
import { xLayer, xLayerTestnet } from "viem/chains";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import {
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  x402HTTPResourceServer,
} from "@okxweb3/x402-core/http";
import type { HTTPTransportContext, RoutesConfig } from "@okxweb3/x402-core/server";
import type { PaymentRequirements, SettleResponse } from "@okxweb3/x402-core/types";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { paymentMiddlewareFromHTTPServer, x402ResourceServer } from "@okxweb3/x402-express";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  GENESIS_AMOUNT,
  GENESIS_AMOUNT_ATOMIC,
  RENEWAL_AMOUNT,
  RENEWAL_AMOUNT_ATOMIC,
} from "../config.js";
import type { PaymentReference } from "../domain/types.js";
import type { Repository, SettlementProgress } from "../db/store.js";
import { hashJcs } from "../evidence/canonical.js";
import { resolvePublic, validateTargetUrl } from "../security/network.js";

const protectedPaths = new Set(["/api/rehearsals", "/api/renewals", "/mcp/rehearse", "/mcp/renew"]);

export function rehearsalTargetSchemaFor(allowPrivate = false) {
  return z.string().url().max(2_048).superRefine((value, context) => {
  try {
    const url = validateTargetUrl(value, allowPrivate);
    if (url.search || url.hash) context.addIssue({ code: "custom", message: "Target query strings and fragments are forbidden" });
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid public target URL" });
  }
  });
}
export const rehearsalTargetSchema = rehearsalTargetSchemaFor(false);
export const idempotencyKeySchema = z.string().min(8).max(120);
export const previousRunIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const protectedRequestArgumentsSchema = z.object({
  url: rehearsalTargetSchema,
  idempotency_key: idempotencyKeySchema,
  previous_run_id: previousRunIdSchema.optional(),
}).strict();

function dailyCapacity(config: Pick<Config, "GLOBAL_RUN_LIMIT_PER_DAY">) {
  const timestamp = new Date().toISOString();
  return { since: `${timestamp.slice(0, 10)}T00:00:00.000Z`, limit: config.GLOBAL_RUN_LIMIT_PER_DAY };
}

export interface SettledRequest {
  body: unknown;
  path: string;
  payment: PaymentReference;
}

export interface ReservedRequest {
  body: unknown;
  path: string;
  run_id: string;
}

interface PaymentAttempt {
  key: string;
  runId: string;
  claimed: boolean;
}

export function createPaymentMiddleware(
  config: Config,
  repository: Repository,
  onSettled?: (request: SettledRequest) => Promise<void>,
  onReserve?: (request: Omit<ReservedRequest, "run_id">) => Promise<{ run_id: string }>,
): RequestHandler {
  if (!config.paymentReady || !config.PAYOUT_ADDRESS) {
    return (request: Request, response: Response, next: NextFunction) => {
      if (!protectedPaths.has(request.path)) return next();
      if (isUnchargedMcpRequest(request.body)) return next();
      if (isAuthorizedLocalRun(request, config)) return next();
      response.status(402).json({
        error: "payment_required",
        detail: "Production x402 settlement is not configured. Local runs require ALLOW_LOCAL_UNPAID_RUNS and x-launchproof-local-run: true.",
        local_only: true,
      });
    };
  }
  const facilitator = new OKXFacilitatorClient({
    apiKey: config.OKX_API_KEY!,
    secretKey: config.OKX_SECRET_KEY!,
    passphrase: config.OKX_PASSPHRASE!,
    ...(config.OKX_BASE_URL ? { baseUrl: config.OKX_BASE_URL } : {}),
    syncSettle: true,
  });
  const server = new x402ResourceServer(facilitator);
  server.register(config.chain.network, new ExactEvmScheme());
  const payTo = config.PAYOUT_ADDRESS as `0x${string}`;
  const routes: RoutesConfig = {
    "POST /api/rehearsals": route(config, GENESIS_AMOUNT_ATOMIC, payTo, "Genesis Launch Rehearsal"),
    "POST /mcp/rehearse": route(config, GENESIS_AMOUNT_ATOMIC, payTo, "Genesis Launch Rehearsal MCP"),
    "POST /api/renewals": route(config, RENEWAL_AMOUNT_ATOMIC, payTo, "Renew Service Passport"),
    "POST /mcp/renew": route(config, RENEWAL_AMOUNT_ATOMIC, payTo, "Renew Service Passport MCP"),
  };
  const httpServer = new x402HTTPResourceServer(server, routes);
  const inFlight = new Set<string>();
  const attempts = new Map<string, PaymentAttempt>();
  const cleanupAttempt = (fingerprint: string, attempt: PaymentAttempt | undefined) => {
    if (attempt) inFlight.delete(attempt.key);
    attempts.delete(fingerprint);
  };
  httpServer.onProtectedRequest(async (context) => {
    const body = context.adapter.getBody?.();
    if (isUnchargedMcpRequest(body)) return { grantAccess: true };
    let key: string;
    try {
      const args = await validateProtectedRequest(body, context.path);
      key = requireBoundIdempotencyKey(context.adapter.getHeader("idempotency-key"), args);
    } catch (error) {
      return { abort: true, reason: error instanceof Error ? error.message : "Invalid protected request" };
    }
    let existing = await repository.getByIdempotencyKey(key);
    if (existing && !idempotencySemanticsMatch(existing, body, context.path)) {
      return { abort: true, reason: "Idempotency key is bound to a different target, operation, or renewal lineage" };
    }
    if (!context.paymentHeader) return;
    if (existing) {
      if (existing.state === "settlement_claimed") {
        return { abort: true, reason: "A verified settlement for this run is already in progress" };
      }
      if (existing.state === "payment_ambiguous") {
        return { abort: true, reason: "A prior settlement outcome is ambiguous and requires chain reconciliation" };
      }
      if (existing.state !== "payment_required") return { grantAccess: true };
    }
    if (inFlight.has(key)) return { abort: true, reason: "A payment attempt with this idempotency key is already in flight" };
    try {
      if (!existing) {
        if (!onReserve) return { abort: true, reason: "Paid request reservation is not configured" };
        const reserved = await onReserve({ body, path: context.path });
        existing = await repository.getRun(reserved.run_id);
        if (!existing || existing.run_id !== reserved.run_id || !idempotencySemanticsMatch(existing, body, context.path)) {
          return { abort: true, reason: "Paid request reservation could not be proven" };
        }
      }
      const payload = decodePaymentSignatureHeader(context.paymentHeader);
      const fingerprint = hashJcs(payload);
      if (attempts.has(fingerprint)) return { abort: true, reason: "This payment authorization is already in flight" };
      inFlight.add(key);
      attempts.set(fingerprint, { key, runId: existing.run_id, claimed: false });
      setTimeout(() => {
        const attempt = attempts.get(fingerprint);
        if (attempt && !attempt.claimed) cleanupAttempt(fingerprint, attempt);
      }, 60_000).unref();
    } catch (error) {
      return { abort: true, reason: error instanceof Error ? error.message : "Invalid payment authorization" };
    }
  });
  const inFlightPayers = new Set<string>();
  server.onAfterVerify(async (context) => {
    const fingerprint = hashJcs(context.paymentPayload);
    const attempt = attempts.get(fingerprint);
    if (!attempt) throw new Error("Verified payment has no correlated durable request reservation");
    if (!context.result.isValid) {
      cleanupAttempt(fingerprint, attempt);
      return;
    }
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await repository.claimRunCapacity(attempt.runId, dailyCapacity(config), leaseExpiresAt);
    attempt.claimed = true;
  });
  server.onVerifyFailure(async (context) => {
    const fingerprint = hashJcs(context.paymentPayload);
    const attempt = attempts.get(fingerprint);
    if (attempt?.claimed) await repository.releaseRunCapacity(attempt.runId);
    cleanupAttempt(fingerprint, attempt);
  });
  server.onBeforeSettle(async (context) => {
    const fingerprint = hashJcs(context.paymentPayload);
    const attempt = attempts.get(fingerprint);
    if (!attempt?.claimed) return { abort: true, reason: "capacity_claim_missing", message: "Settlement has no durable capacity claim" };
    const payer = paymentPayloadPayer(context.paymentPayload);
    if (!payer) {
      await repository.releaseRunCapacity(attempt.runId);
      cleanupAttempt(fingerprint, attempt);
      return { abort: true, reason: "payer_missing", message: "Verified payment omitted a payer address" };
    }
    if (inFlightPayers.has(payer)) {
      await repository.releaseRunCapacity(attempt.runId);
      cleanupAttempt(fingerprint, attempt);
      return { abort: true, reason: "payer_limit_in_flight", message: "Another payment for this payer is settling" };
    }
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const settled = await repository.settledLaunchPaymentsByPayerSince(payer, since);
    if (settled >= config.PAID_RATE_LIMIT_PER_HOUR) {
      await repository.releaseRunCapacity(attempt.runId);
      cleanupAttempt(fingerprint, attempt);
      return { abort: true, reason: "payer_hourly_limit", message: "Payer hourly rehearsal limit reached" };
    }
    inFlightPayers.add(payer);
    setTimeout(() => inFlightPayers.delete(payer), 60_000).unref();
  });
  server.onSettleFailure(async (context) => {
    const fingerprint = hashJcs(context.paymentPayload);
    const attempt = attempts.get(fingerprint);
    const payer = paymentPayloadPayer(context.paymentPayload);
    if (payer) inFlightPayers.delete(payer);
    if (attempt?.claimed) {
      await repository.markPaymentAmbiguous(
        attempt.runId,
        "Settlement was attempted but its final on-chain transfer was not proven",
      );
    }
    cleanupAttempt(fingerprint, attempt);
  });
  server.onAfterSettle(async (context) => {
    const fingerprint = hashJcs(context.paymentPayload);
    const attempt = attempts.get(fingerprint);
    if (!attempt?.claimed) throw new Error("Settled payment has no durable capacity claim");
    const transport = context.transportContext as HTTPTransportContext | undefined;
    if (!transport || !protectedPaths.has(transport.request.path)) return;
    const body = transport.request.adapter.getBody?.();
    const args = await validateProtectedRequest(body, transport.request.path);
    const key = requireBoundIdempotencyKey(transport.request.adapter.getHeader("idempotency-key"), args);
    const reserved = await repository.getByIdempotencyKey(key);
    if (!reserved || reserved.run_id !== attempt.runId) throw new Error("Settled request has no correlated durable run reservation");
    const settlement = settlementProgress(config, context.result, context.requirements, transport.request.path);
    await repository.recordPaymentSettlement(reserved.run_id, settlement);
    const payment = await settledPaymentReference(
      config,
      context.result,
      context.requirements,
      transport.request.path,
    );
    await repository.authorizeRun(payment, reserved.run_id, dailyCapacity(config));
    await onSettled?.({ body, path: transport.request.path, payment });
    if (payment.payer) inFlightPayers.delete(payment.payer.toLowerCase());
    cleanupAttempt(fingerprint, attempt);
  });
  return paymentMiddlewareFromHTTPServer(httpServer) as RequestHandler;
}

export async function reconcilePendingLaunchPayments(config: Config, repository: Repository): Promise<number> {
  if (!config.XLAYER_RPC_URL || !config.PAYOUT_ADDRESS) return 0;
  const client = settlementPublicClient(config);
  let reconciled = 0;
  for (const progress of await repository.pendingPaymentSettlements()) {
    const settlement = progress.settlement;
    if (!settlement) continue;
    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
    try {
      receipt = await client.getTransactionReceipt({ hash: settlement.transaction_hash as `0x${string}` });
    } catch {
      continue;
    }
    if (receipt.status === "reverted") {
      await repository.resetPaymentAmbiguous(progress.run_id);
      reconciled += 1;
      continue;
    }
    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: config.chain.network,
      asset: config.chain.usdt0Address,
      amount: settlement.amount_atomic,
      payTo: config.PAYOUT_ADDRESS,
      maxTimeoutSeconds: 60,
      extra: {},
    };
    const response = {
      success: true,
      status: "success",
      transaction: settlement.transaction_hash,
      network: config.chain.network,
      payer: settlement.payer,
      amount: settlement.amount_atomic,
    } as SettleResponse;
    try {
      const payment = await settledPaymentReference(config, response, requirements, settlement.route);
      await repository.authorizeRun(payment, progress.run_id, dailyCapacity(config));
      reconciled += 1;
    } catch (error) {
      await repository.markPaymentAmbiguous(
        progress.run_id,
        error instanceof Error ? error.message : "Settlement reconciliation failed",
      );
    }
  }
  return reconciled;
}

export function requireBoundIdempotencyKey(
  header: string | undefined,
  args: { idempotency_key: string },
): string {
  const headerKey = idempotencyKeySchema.safeParse(header);
  if (!headerKey.success) throw new Error("Protected paid calls require a valid idempotency-key header");
  if (headerKey.data !== args.idempotency_key) {
    throw new Error("idempotency-key header must exactly match the request body key");
  }
  return headerKey.data;
}

async function validateProtectedRequest(body: unknown, path: string) {
  const args = protectedRequestArgumentsSchema.parse(requestArguments(body));
  const renewal = path.includes("renew");
  if (renewal && !args.previous_run_id) throw new Error("Paid renewal requires a bytes32 previous_run_id");
  if (!renewal && args.previous_run_id) throw new Error("Paid genesis request cannot contain previous_run_id");
  const target = validateTargetUrl(args.url, false);
  await resolvePublic(target, false);
  return args;
}

function idempotencySemanticsMatch(
  stored: Awaited<ReturnType<Repository["getByIdempotencyKey"]>> & {},
  body: unknown,
  path: string,
): boolean {
  const args = requestArguments(body);
  if (!args || typeof args.url !== "string") return false;
  let target: string;
  try {
    const url = new URL(args.url);
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/.well-known/launch-contract.json";
    target = url.toString();
  } catch {
    return false;
  }
  const operation = path.includes("renew") ? "renewal" : "genesis";
  const previous = typeof args.previous_run_id === "string" ? args.previous_run_id : null;
  const storedTarget = "canonical_evidence" in stored ? stored.canonical_evidence.target : stored.target;
  const storedOperation = "canonical_evidence" in stored
    ? (stored.previous_run_id ? "renewal" : "genesis")
    : stored.operation;
  const storedPrevious = stored.previous_run_id ?? null;
  return target === storedTarget && operation === storedOperation && previous === storedPrevious;
}

function requestArguments(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const direct = body as Record<string, unknown>;
  const nested = (body as { params?: { arguments?: unknown } }).params?.arguments;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : direct;
}

function paymentPayloadPayer(paymentPayload: { payload: Record<string, unknown> }): string | null {
  const authorization = paymentPayload.payload.authorization;
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) return null;
  const from = (authorization as { from?: unknown }).from;
  return typeof from === "string" && /^0x[0-9a-fA-F]{40}$/.test(from) ? from.toLowerCase() : null;
}

function route(config: Config, amount: string, payTo: `0x${string}`, description: string) {
  return {
    accepts: [{
      scheme: "exact",
      network: config.chain.network,
      payTo,
      price: {
        amount,
        asset: config.chain.usdt0Address,
        extra: { name: "USD₮0", version: "1" },
      },
    }],
    description,
    mimeType: "application/json",
  };
}

export async function launchPaymentReference(
  request: Request,
  response: Response,
  price: "0.01" | "0.10",
  routePath: string,
  config: Config,
): Promise<PaymentReference> {
  const responseProof = String(response.getHeader("payment-response") ?? "");
  const paymentId = `local-${randomUUID()}`;
  if (responseProof) {
    const decoded = decodePaymentResponseHeader(responseProof);
    const amountAtomic = price === "0.01" ? GENESIS_AMOUNT_ATOMIC : RENEWAL_AMOUNT_ATOMIC;
    return settledPaymentReference(config, decoded, {
      scheme: "exact",
      network: config.chain.network,
      asset: config.chain.usdt0Address,
      amount: amountAtomic,
      payTo: config.PAYOUT_ADDRESS ?? "",
      maxTimeoutSeconds: 60,
      extra: {},
    }, routePath);
  }
  if (config.X402_ENABLED) {
    throw new Error("Official x402 middleware did not provide a final settlement transaction");
  }
  const amountAtomic = price === "0.01" ? GENESIS_AMOUNT_ATOMIC : RENEWAL_AMOUNT_ATOMIC;
  return {
    payment_id: paymentId,
    kind: "launchproof",
    amount: amountAtomic,
    amount_atomic: amountAtomic,
    amount_display: price,
    asset_decimals: config.chain.usdt0Decimals,
    asset: config.chain.usdt0Address,
    network: config.chain.network,
    payer: null,
    recipient: config.PAYOUT_ADDRESS ?? null,
    route: routePath,
    settlement_transaction: null,
    status: "local_only",
    timestamp: new Date().toISOString(),
  };
}

export async function settledPaymentReference(
  config: Config,
  settlement: SettleResponse,
  requirements: PaymentRequirements,
  routePath: string,
  verifyTransfer: typeof verifySettlementTransfer = verifySettlementTransfer,
): Promise<PaymentReference> {
  if (!settlement.success || settlement.status !== "success") throw new Error("LaunchProof x402 settlement is not final");
  if (settlement.network !== config.chain.network || requirements.network !== config.chain.network) {
    throw new Error("LaunchProof x402 settlement used the wrong network");
  }
  const expectedAmount = routePath.includes("renew") ? RENEWAL_AMOUNT_ATOMIC : GENESIS_AMOUNT_ATOMIC;
  const expectedDisplay = routePath.includes("renew") ? RENEWAL_AMOUNT : GENESIS_AMOUNT;
  if (
    requirements.scheme !== "exact" ||
    requirements.asset.toLowerCase() !== config.chain.usdt0Address.toLowerCase() ||
    requirements.amount !== expectedAmount ||
    requirements.payTo.toLowerCase() !== config.PAYOUT_ADDRESS?.toLowerCase() ||
    (settlement.amount !== undefined && settlement.amount !== expectedAmount)
  ) {
    throw new Error("LaunchProof x402 settlement does not match the configured payment policy");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)) throw new Error("Settlement omitted a transaction hash");
  const payer = settlement.payer && /^0x[0-9a-fA-F]{40}$/.test(settlement.payer) ? settlement.payer : null;
  if (!payer) throw new Error("Settlement omitted a valid payer address");
  const settledAt = await verifyTransfer(config, settlement.transaction as `0x${string}`, payer, expectedAmount);
  return {
    payment_id: settlement.transaction,
    kind: "launchproof",
    amount: expectedAmount,
    amount_atomic: expectedAmount,
    amount_display: expectedDisplay,
    asset_decimals: config.chain.usdt0Decimals,
    asset: config.chain.usdt0Address,
    network: config.chain.network,
    payer,
    recipient: config.PAYOUT_ADDRESS ?? null,
    route: routePath,
    settlement_transaction: settlement.transaction,
    status: "settled",
    timestamp: settledAt,
  };
}

function settlementProgress(
  config: Config,
  settlement: SettleResponse,
  requirements: PaymentRequirements,
  routePath: string,
): SettlementProgress {
  if (!settlement.success || settlement.status !== "success") throw new Error("LaunchProof x402 settlement is not final");
  if (settlement.network !== config.chain.network || requirements.network !== config.chain.network) {
    throw new Error("LaunchProof x402 settlement used the wrong network");
  }
  const expectedAmount = routePath.includes("renew") ? RENEWAL_AMOUNT_ATOMIC : GENESIS_AMOUNT_ATOMIC;
  if (requirements.scheme !== "exact" ||
    requirements.asset.toLowerCase() !== config.chain.usdt0Address.toLowerCase() ||
    requirements.amount !== expectedAmount ||
    requirements.payTo.toLowerCase() !== config.PAYOUT_ADDRESS?.toLowerCase() ||
    (settlement.amount !== undefined && settlement.amount !== expectedAmount)) {
    throw new Error("LaunchProof x402 settlement does not match the configured payment policy");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)) throw new Error("Settlement omitted a transaction hash");
  if (!settlement.payer || !/^0x[0-9a-fA-F]{40}$/.test(settlement.payer)) {
    throw new Error("Settlement omitted a valid payer address");
  }
  return {
    transaction_hash: settlement.transaction,
    payer: settlement.payer,
    amount_atomic: expectedAmount,
    route: routePath,
    observed_at: new Date().toISOString(),
  };
}

export function isUnchargedMcpRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const method = (body as { method?: unknown }).method;
  return method === "initialize" ||
    method === "notifications/initialized" ||
    method === "tools/list" ||
    method === "ping";
}

export function isAuthorizedLocalRun(request: Request, config: Config): boolean {
  return config.ALLOW_LOCAL_UNPAID_RUNS &&
    request.header("x-launchproof-local-run") === "true" &&
    isLoopbackHost(request.hostname) &&
    isLoopbackHost(new URL(config.PUBLIC_API_BASE_URL).hostname) &&
    isLoopbackAddress(request.socket.remoteAddress ?? request.ip ?? "");
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127(?:\.[0-9]{1,3}){3}$/.test(host);
}

function isLoopbackAddress(address: string): boolean {
  return isLoopbackHost(address.replace(/^::ffff:/, ""));
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

async function verifySettlementTransfer(
  config: Config,
  transaction: `0x${string}`,
  payer: string | null,
  amountAtomic: string,
): Promise<string> {
  if (!config.XLAYER_RPC_URL || !config.PAYOUT_ADDRESS) throw new Error("Settlement verification RPC and payout address are required");
  const client = settlementPublicClient(config);
  const receipt = await client.waitForTransactionReceipt({ hash: transaction, confirmations: 2, timeout: 20_000 });
  if (receipt.status !== "success") throw new Error("LaunchProof x402 settlement transaction reverted");
  const expectedAmount = BigInt(amountAtomic);
  const transferMatches = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== config.chain.usdt0Address.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: transferEvent, data: log.data, topics: log.topics, strict: true });
      const args = decoded.args as { from: string; to: string; value: bigint };
      return args.to.toLowerCase() === config.PAYOUT_ADDRESS!.toLowerCase() &&
        args.value === expectedAmount &&
        (!payer || args.from.toLowerCase() === payer.toLowerCase());
    } catch {
      return false;
    }
  });
  if (!transferMatches) throw new Error("Settlement transaction does not contain the required USD₮0 transfer");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return new Date(Number(block.timestamp) * 1_000).toISOString();
}

function settlementPublicClient(config: Config) {
  const transports = [http(config.XLAYER_RPC_URL!), ...(config.XLAYER_FALLBACK_RPC_URL ? [http(config.XLAYER_FALLBACK_RPC_URL)] : [])];
  return createPublicClient({
    chain: config.chain.testnet ? xLayerTestnet : xLayer,
    transport: transports.length > 1 ? fallback(transports) : transports[0]!,
  });
}

export const launchPrices = {
  genesis: { decimal: GENESIS_AMOUNT, atomic: GENESIS_AMOUNT_ATOMIC },
  renewal: { decimal: RENEWAL_AMOUNT, atomic: RENEWAL_AMOUNT_ATOMIC },
} as const;
