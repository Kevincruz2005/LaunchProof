import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { decodePaymentSignatureHeader } from "@okxweb3/x402-core/http";
import { z } from "zod";
import type { Config } from "../config.js";
import { GENESIS_PRICE, NETWORK, RENEWAL_PRICE, USDT0_ADDRESS } from "../config.js";
import { MemoryRepository, type Repository } from "../db/store.js";
import { createPaymentMiddleware, launchPaymentReference } from "../payments/inbound.js";
import { RehearsalService } from "../workers/rehearsal.js";
import { handleMcp } from "../mcp/server.js";
import { RegistryService } from "../chain/registry.js";
import { hashJcs } from "../evidence/canonical.js";

const requestSchema = z.object({
  url: z.string().url(),
  idempotency_key: z.string().min(8).max(120),
  previous_run_id: z.string().min(1).max(100).optional(),
});

export function createApp(config: Config, repository: Repository = new MemoryRepository()) {
  const app = express();
  const service = new RehearsalService(config, repository);
  const registry = new RegistryService(config);
  app.disable("x-powered-by");
  app.use(cors({ origin: true, methods: ["GET", "POST"], allowedHeaders: ["content-type", "payment", "payment-signature", "x-payment", "x-launchproof-local-run", "idempotency-key"], exposedHeaders: ["payment-response", "location"] }));
  app.use((_request, response, next) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("x-launchproof-build", config.BUILD_COMMIT_SHA);
    next();
  });
  app.use(express.json({ limit: "64kb", strict: true }));

  const freeLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.FREE_RATE_LIMIT_PER_MINUTE,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const paidLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: config.PAID_RATE_LIMIT_PER_HOUR,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (request) => !new Set(["/api/rehearsals", "/api/renewals", "/mcp/rehearse", "/mcp/renew"]).has(request.path),
    keyGenerator: (request) => paymentPayer(request) ?? ipKeyGenerator(request.ip ?? "unknown"),
  });
  const globalRuns = rateLimit({
    windowMs: 24 * 60 * 60_000,
    limit: config.GLOBAL_RUN_LIMIT_PER_DAY,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: () => "launchproof-campaign-global",
  });
  app.use(paidLimiter);
  app.use(["/api/rehearsals", "/api/renewals", "/mcp/rehearse", "/mcp/renew"], globalRuns);
  app.use(createPaymentMiddleware(config, repository));

  app.get("/healthz", freeLimiter, (_request, response) => {
    response.json({
      name: "LaunchProof",
      version: "1.0.0",
      build_commit: config.BUILD_COMMIT_SHA,
      timestamp: new Date().toISOString(),
      dependencies: {
        x402: config.productionReady ? "configured" : "not_configured",
        registry: config.REGISTRY_ADDRESS ? "configured" : "not_configured",
        database: config.DATABASE_URL ? "configured" : "memory_cache",
      },
    });
  });

  app.get("/.well-known/launchproof.json", freeLimiter, (_request, response) => response.json(projectCard(config)));

  app.post("/api/rehearsals", asyncRoute(async (request, response) => {
    const body = requestSchema.parse(request.body);
    if (body.previous_run_id) throw new HttpError(400, "Use /api/renewals when previous_run_id is supplied");
    const run = await service.reserve(body.url, body.idempotency_key);
    if (run.state === "payment_required") {
      afterSettlement(request, response, repository, run.run_id, async () => {
        const payment = launchPaymentReference(request, response, "0.01", "/api/rehearsals", config);
        await service.runReserved(run.run_id, { url: body.url, idempotency_key: body.idempotency_key, payment }, false);
      });
    }
    response.status("canonical_evidence" in run ? 200 : 202).location(`/runs/${run.run_id}`).json(run);
  }));

  app.post("/api/renewals", asyncRoute(async (request, response) => {
    const body = requestSchema.parse(request.body);
    if (!body.previous_run_id) throw new HttpError(400, "previous_run_id is required");
    const run = await service.reserve(body.url, body.idempotency_key);
    if (run.state === "payment_required") {
      afterSettlement(request, response, repository, run.run_id, async () => {
        const payment = launchPaymentReference(request, response, "0.10", "/api/renewals", config);
        await service.runReserved(
          run.run_id,
          { url: body.url, idempotency_key: body.idempotency_key, payment, previous_run_id: body.previous_run_id! },
          false,
        );
      });
    }
    response.status("canonical_evidence" in run ? 200 : 202).location(`/runs/${run.run_id}`).json(run);
  }));

  app.post("/mcp/rehearse", (request, response, next) => {
    void handleMcp(request, response, "rehearse", service, repository, config).catch(next);
  });
  app.post("/mcp/renew", (request, response, next) => {
    void handleMcp(request, response, "renew", service, repository, config).catch(next);
  });
  app.post("/mcp/public", freeLimiter, (request, response, next) => {
    void handleMcp(request, response, "public", service, repository, config).catch(next);
  });

  app.get("/runs", freeLimiter, asyncRoute(async (_request, response) => {
    response.json({ runs: await repository.recentRuns(20), build_commit: config.BUILD_COMMIT_SHA });
  }));
  app.get("/runs/:runId", freeLimiter, asyncRoute(async (request, response) => {
    const runId = param(request.params.runId);
    const cached = await repository.getRun(runId);
    const chainRun = config.productionReady ? await registry.readPublishedRun(runId) : null;
    const run = config.productionReady
      ? chainRun ?? (cached && !("canonical_evidence" in cached) ? cached : null)
      : cached;
    if (!run) throw new HttpError(404, "Run not found");
    if ("canonical_evidence" in run) {
      const challenges = run.canonical_evidence.challenges;
      response.json({
        ...run,
        challenge_summary: {
          runs: challenges,
          pass_count: challenges.filter((item) => item.classification === null).length,
          generation_time: run.canonical_evidence.generated_at,
        },
        receipt_url: `${config.PUBLIC_WEB_BASE_URL}/receipts/${run.payment.payment_id}`,
      });
      return;
    }
    response.status(run.state === "failed" ? 500 : 202).json(run);
  }));

  app.get("/verify/:runId", freeLimiter, asyncRoute(async (request, response) => {
    const runId = param(request.params.runId);
    const stored = await repository.getRun(runId);
    const cache = stored && "canonical_evidence" in stored ? stored : null;
    response.json(await registry.verify(runId, cache));
  }));

  app.get("/receipts/:paymentId", freeLimiter, asyncRoute(async (request, response) => {
    const payment = await repository.getPayment(param(request.params.paymentId));
    if (!payment) throw new HttpError(404, "Payment receipt not found");
    const cached = await repository.getRun(payment.run_id);
    const run = config.productionReady && (!cached || "canonical_evidence" in cached)
      ? await registry.readPublishedRun(payment.run_id)
      : cached && "canonical_evidence" in cached ? cached : null;
    const { run_id: paymentRunId, ...paymentReference } = payment;
    const canonicalPayment = run
      ? payment.kind === "launchproof" ? run.payment : run.target_payment
      : null;
    const chainRunLinkageMatches = Boolean(
      payment.status === "settled" &&
      payment.settlement_transaction &&
      run?.chain.published &&
      canonicalPayment &&
      paymentRunId === run.run_id &&
      hashJcs(paymentReference) === hashJcs(canonicalPayment),
    );
    response.json({
      ...payment,
      source_commit: run?.build_commit_sha ?? config.BUILD_COMMIT_SHA,
      explorer_url: payment.settlement_transaction ? `https://www.oklink.com/xlayer/tx/${payment.settlement_transaction}` : null,
      run_url: `${config.PUBLIC_WEB_BASE_URL}/passport/${payment.run_id}`,
      chain_run_linkage_matches: chainRunLinkageMatches,
    });
  }));

  app.get("/status", freeLimiter, asyncRoute(async (_request, response) => {
    response.json({
      observed_at: new Date().toISOString(),
      service: config.productionReady ? "configured" : "local_configuration_incomplete",
      listing: config.OKX_AI_LISTING_URL ? "published" : "not_configured",
      prices: { genesis_rehearsal: "0.01 USDT0", renew_passport: "0.10 USDT0" },
      registry: config.REGISTRY_ADDRESS ?? null,
      recent_runs: await repository.recentRuns(10),
      disclaimer: "This page shows observed status at the time of your visit and a historical log of past runs. It is not an uptime guarantee or a service-level agreement, and no future availability is promised.",
    });
  }));

  app.get("/fixtures", freeLimiter, (_request, response) => response.json({ fixtures: fixtureCatalog(config) }));
  app.get("/docs/quick-verify", freeLimiter, (_request, response) => response.json({
    title: "Verify LaunchProof in under two minutes",
    steps: [
      "Read the project card and make one real paid Genesis Launch Rehearsal call.",
      "Run the documented invalid-output fixture and confirm the exact failed assertion and fixture label.",
      "Run the healthy fixture and confirm the fixed sample and three fresh challenges pass.",
      "Inspect /runs/{runId}, follow the payment and evidence transactions, and recompute hashes through /verify/{runId} or scripts/verify-run.sh.",
    ],
  }));

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
  const openapi = JSON.parse(readFileSync(path.join(root, "schema", "openapi.json"), "utf8")) as Record<string, unknown>;
  app.get("/schema/openapi.json", freeLimiter, (_request, response) => response.json({ ...openapi, servers: [{ url: config.PUBLIC_API_BASE_URL }] }));
  app.get("/schema/launch-contract.schema.json", freeLimiter, (_request, response) => response.sendFile(path.join(root, "schema", "launch-contract.schema.json")));
  app.get("/schema/registry.abi.json", freeLimiter, (_request, response) => response.sendFile(path.join(root, "schema", "registry.abi.json")));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: "invalid_request", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Internal error";
    response.status(status).json({ error: status === 500 ? "internal_error" : "request_failed", message });
  });
  return app;
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
}

function afterSettlement(
  request: Request,
  response: Response,
  repository: Repository,
  runId: string,
  callback: () => Promise<void>,
) {
  response.once("finish", () => {
    void callback().catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Post-settlement execution failed";
      await repository.updateState(runId, "failed", message);
    });
  });
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function paymentPayer(request: Request): string | null {
  const header = request.header("payment-signature") ?? request.header("x-payment");
  if (!header) return null;
  try {
    const payload = decodePaymentSignatureHeader(header) as unknown as {
      payload?: { authorization?: { from?: unknown } };
    };
    const payer = payload.payload?.authorization?.from;
    return typeof payer === "string" && /^0x[0-9a-fA-F]{40}$/.test(payer) ? payer.toLowerCase() : null;
  } catch {
    return null;
  }
}

function projectCard(config: Config) {
  const api = config.PUBLIC_API_BASE_URL;
  const web = config.PUBLIC_WEB_BASE_URL;
  return {
    name: "LaunchProof",
    version: "1.0.0",
    one_line_pitch: "LaunchProof rehearses an agent's advertised paid task and gives buyers a versioned passport before they pay for the real job.",
    category: "Software services",
    okx_ai_listing_url: config.OKX_AI_LISTING_URL ?? null,
    mcp_endpoint: `${api}/mcp/rehearse`,
    tools: ["rehearse_launch_contract", "get_service_passport"],
    compatibility_tools: ["preflight_service", "get_run"],
    price_usdt: "0.10",
    prices_usdt: { genesis_rehearsal: "0.01", renew_passport: "0.10" },
    source_repository: config.SOURCE_REPOSITORY,
    source_commit: config.BUILD_COMMIT_SHA,
    build_commit: config.BUILD_COMMIT_SHA,
    quick_verify_url: `${web}/docs/quick-verify`,
    fixture_catalog_url: `${web}/fixtures`,
    payment_receipt_url: config.REFERENCE_PAYMENT_ID ? `${web}/receipts/${encodeURIComponent(config.REFERENCE_PAYMENT_ID)}` : null,
    demo_video_url: config.DEMO_VIDEO_URL ?? null,
    status_url: `${web}/status`,
    rest_endpoint: `${api}/api`,
    network: NETWORK,
    settlement_asset: "USDT0",
    settlement_asset_address: USDT0_ADDRESS,
    registry_contract_address: config.REGISTRY_ADDRESS ?? null,
    registry_model: "immutable single-writer attestation registry",
    rate_limits: { free_per_ip_per_minute: config.FREE_RATE_LIMIT_PER_MINUTE, paid_per_wallet_per_hour: config.PAID_RATE_LIMIT_PER_HOUR, global_rehearsals_per_day: config.GLOBAL_RUN_LIMIT_PER_DAY },
    limits: ["Public HTTPS MCP endpoints only", "No credentials, target writes, arbitrary code execution, or undeclared external side effects", "Evidence is an operational point-in-time record, not a security certification"],
    disclaimers: [
      "LaunchProof is not a security certification.",
      "A passport reflects a point-in-time rehearsal and is not a guarantee of future uptime or behavior.",
      "A LaunchProof passport is not OKX marketplace identity verification and is not issued or endorsed by OKX.",
    ],
    generated_at: new Date().toISOString(),
  };
}

function fixtureCatalog(config: Config) {
  const base = config.FIXTURE_BASE_DOMAIN;
  const declarations: Record<string, string | undefined> = {
    healthy: config.FIXTURE_HEALTHY_PROVIDER_ADDRESS,
    "invalid-output": config.FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS,
    "schema-drift": config.FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS,
    timeout: config.FIXTURE_TIMEOUT_PROVIDER_ADDRESS,
  };
  const fixtures: ReadonlyArray<readonly [string, string]> = [
    ["healthy", "All gates pass, including paid delivery"],
    ["invalid-output", "fresh_challenge fails with invalid_output"],
    ["schema-drift", "contract_correct or fresh_challenge fails with schema_drift"],
    ["timeout", "the relevant gate fails with timeout"],
  ];
  return fixtures.map(([variant, intendedOutcome]) => ({
    variant,
    label: "fixture",
    launch_contract: base ? `https://${variant}.${base}/.well-known/launch-contract.json` : null,
    health: base ? `https://${variant}.${base}/healthz` : null,
    source: `${config.SOURCE_REPOSITORY}/tree/${config.BUILD_COMMIT_SHA}/fixtures/invoice-normalizer-${variant}`,
    declaration_address: declarations[variant] ?? null,
    intended_outcome: intendedOutcome,
  }));
}
