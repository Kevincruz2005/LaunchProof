import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { decodePaymentResponseHeader, x402HTTPResourceServer } from "@okxweb3/x402-core/http";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { paymentMiddlewareFromHTTPServer, x402ResourceServer } from "@okxweb3/x402-express";
import type { Config } from "../config.js";
import { GENESIS_PRICE, NETWORK, RENEWAL_PRICE, USDT0_ADDRESS } from "../config.js";
import type { PaymentReference } from "../domain/types.js";
import type { Repository } from "../db/store.js";

const protectedPaths = new Set(["/api/rehearsals", "/api/renewals", "/mcp/rehearse", "/mcp/renew"]);

export function createPaymentMiddleware(config: Config, repository: Repository): RequestHandler {
  if (!config.productionReady || !config.PAYOUT_ADDRESS) {
    return (request: Request, response: Response, next: NextFunction) => {
      if (!protectedPaths.has(request.path)) return next();
      if (config.ALLOW_LOCAL_UNPAID_RUNS && request.header("x-launchproof-local-run") === "true") return next();
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
    ...(config.OKX_BASE_URL ? { baseURL: config.OKX_BASE_URL } : {}),
  });
  const server = new x402ResourceServer(facilitator);
  server.register(NETWORK, new ExactEvmScheme());
  const routes = {
    "POST /api/rehearsals": route(GENESIS_PRICE, config.PAYOUT_ADDRESS as `0x${string}`, "Genesis Launch Rehearsal"),
    "POST /mcp/rehearse": route(GENESIS_PRICE, config.PAYOUT_ADDRESS as `0x${string}`, "Genesis Launch Rehearsal MCP"),
    "POST /api/renewals": route(RENEWAL_PRICE, config.PAYOUT_ADDRESS as `0x${string}`, "Renew Service Passport"),
    "POST /mcp/renew": route(RENEWAL_PRICE, config.PAYOUT_ADDRESS as `0x${string}`, "Renew Service Passport MCP"),
  };
  const httpServer = new x402HTTPResourceServer(server, routes);
  const inFlight = new Set<string>();
  httpServer.onProtectedRequest(async (context) => {
    const key = idempotencyKey(context.adapter.getHeader("idempotency-key"), context.adapter.getBody?.());
    if (!key) return;
    const existing = await repository.getByIdempotencyKey(key);
    if (existing && existing.state !== "payment_required") return { grantAccess: true };
    if (inFlight.has(key)) return { abort: true, reason: "A payment attempt with this idempotency key is already in flight" };
    inFlight.add(key);
    setTimeout(() => inFlight.delete(key), 60_000).unref();
  });
  return paymentMiddlewareFromHTTPServer(httpServer) as RequestHandler;
}

function idempotencyKey(header: string | undefined, body: unknown): string | null {
  if (header && header.length >= 8 && header.length <= 120) return header;
  if (!body || typeof body !== "object") return null;
  const direct = (body as { idempotency_key?: unknown }).idempotency_key;
  if (typeof direct === "string") return direct;
  const nested = (body as { params?: { arguments?: { idempotency_key?: unknown } } }).params?.arguments?.idempotency_key;
  return typeof nested === "string" ? nested : null;
}

function route(price: string, payTo: `0x${string}`, description: string) {
  return {
    accepts: [{ scheme: "exact", network: NETWORK, payTo, price }],
    description,
    mimeType: "application/json",
  };
}

export function launchPaymentReference(
  request: Request,
  response: Response,
  price: "0.01" | "0.10",
  routePath: string,
  config: Config,
): PaymentReference {
  const requestProof = request.header("payment-signature") ?? request.header("payment") ?? request.header("x-payment") ?? "";
  const responseProof = String(response.getHeader("payment-response") ?? "");
  const proof = responseProof || requestProof;
  const paymentId = proof
    ? `okx-${createHash("sha256").update(proof).digest("hex").slice(0, 32)}`
    : `local-${randomUUID()}`;
  let transaction: string | null = null;
  let payer: string | null = null;
  if (responseProof) {
    const decoded = decodePaymentResponseHeader(responseProof);
    if (!decoded.success || (decoded.status && decoded.status !== "success")) throw new Error("LaunchProof x402 settlement is not final");
    if (/^0x[0-9a-fA-F]{64}$/.test(decoded.transaction)) transaction = decoded.transaction;
    if (decoded.payer && /^0x[0-9a-fA-F]{40}$/.test(decoded.payer)) payer = decoded.payer;
  }
  if (config.productionReady && !transaction) {
    throw new Error("Official x402 middleware did not provide a final settlement transaction");
  }
  return {
    payment_id: transaction ?? paymentId,
    kind: "launchproof",
    amount: price,
    asset: USDT0_ADDRESS,
    network: NETWORK,
    payer,
    recipient: config.PAYOUT_ADDRESS ?? null,
    route: routePath,
    settlement_transaction: transaction,
    status: config.productionReady ? "settled" : "local_only",
    timestamp: new Date().toISOString(),
  };
}
