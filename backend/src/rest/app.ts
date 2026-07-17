import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  GENESIS_AMOUNT,
  GENESIS_AMOUNT_ATOMIC,
  RENEWAL_AMOUNT,
  RENEWAL_AMOUNT_ATOMIC,
} from "../config.js";
import { MemoryRepository, type Repository } from "../db/store.js";
import {
  createPaymentMiddleware,
  isAuthorizedLocalRun,
  isUnchargedMcpRequest,
  launchPaymentReference,
  protectedRequestArgumentsSchema,
  rehearsalTargetSchemaFor,
} from "../payments/inbound.js";
import { RehearsalService } from "../workers/rehearsal.js";
import { handleMcp } from "../mcp/server.js";
import { RegistryService } from "../chain/registry.js";
import { hashJcs } from "../evidence/canonical.js";

export function createApp(
  config: Config,
  repository: Repository = new MemoryRepository(),
  options: { startupPreflightPassed?: boolean } = {},
) {
  const app = express();
  const requestSchema = protectedRequestArgumentsSchema.extend({
    url: rehearsalTargetSchemaFor(config.ALLOW_PRIVATE_TARGETS),
  });
  const paidRequestSchema = protectedRequestArgumentsSchema;
  const service = new RehearsalService(config, repository);
  const registry = new RegistryService(config);
  app.disable("x-powered-by");
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigin(origin, config.publicAllowedOrigins)) return callback(null, true);
      return callback(new Error("Origin is not allowed"));
    },
    methods: ["GET", "POST"],
    // OKX x402-fetch 0.1.0 adds Access-Control-Expose-Headers to its paid
    // retry. It is response-only and ignored by LaunchProof, but accepting it
    // here keeps that official client compatible while our browser wrapper
    // removes it before sending.
    allowedHeaders: ["content-type", "payment", "payment-signature", "x-payment", "x-launchproof-local-run", "idempotency-key", "access-control-expose-headers"],
    // x402-fetch reads the initial challenge from PAYMENT-REQUIRED in browser
    // JavaScript. CORS hides non-safelisted response headers unless the API
    // explicitly exposes them.
    exposedHeaders: ["payment-required", "payment-response", "location"],
  }));
  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
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
  // This IP limiter only protects the unauthenticated 402 surface. The paid
  // hourly policy is enforced later from the facilitator-verified payer.
  const paymentChallengeLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.FREE_RATE_LIMIT_PER_MINUTE,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (request) =>
      !new Set(["/api/rehearsals", "/api/renewals", "/mcp/rehearse", "/mcp/renew"]).has(request.path) ||
      (request.path.startsWith("/mcp/") && isUnchargedMcpRequest(request.body)),
    keyGenerator: (request) => ipKeyGenerator(request.ip ?? "unknown"),
  });
  app.use(paymentChallengeLimiter);
  const reservePaidRequest = async ({ body, path: requestPath }: { body: unknown; path: string }) => {
    const parsed = paidRequestSchema.parse(mcpArguments(body));
    const renewal = requestPath.includes("renew");
    if (renewal && !parsed.previous_run_id) throw new Error("Paid renewal omitted previous_run_id");
    if (!renewal && parsed.previous_run_id) throw new Error("Paid genesis request cannot contain previous_run_id");
    return service.reserve(
      parsed.url,
      parsed.idempotency_key,
      renewal ? "renewal" : "genesis",
      parsed.previous_run_id ?? null,
    );
  };
  app.use(createPaymentMiddleware(config, repository, async ({ body, path: settledPath, payment }) => {
    const settledBody = paidRequestSchema.parse(mcpArguments(body));
    const renewal = settledPath.includes("renew");
    if (renewal && !settledBody.previous_run_id) throw new Error("Settled renewal omitted previous_run_id");
    if (!renewal && settledBody.previous_run_id) throw new Error("Settled genesis request cannot contain previous_run_id");
    const reserved = await service.reserve(
      settledBody.url,
      settledBody.idempotency_key,
      renewal ? "renewal" : "genesis",
      settledBody.previous_run_id ?? null,
    );
    await service.runReserved(
      reserved.run_id,
      {
        url: settledBody.url,
        idempotency_key: settledBody.idempotency_key,
        payment,
        ...(settledBody.previous_run_id ? { previous_run_id: settledBody.previous_run_id } : {}),
      },
      false,
    );
  }, reservePaidRequest));

  app.get("/healthz", freeLimiter, asyncRoute(async (_request, response) => {
    const [databaseReachable, registryReachable] = await Promise.all([
      repository.healthCheck(),
      config.chainReady ? registry.healthCheck() : Promise.resolve(false),
    ]);
    const healthy = databaseReachable &&
      (!config.chainReady || registryReachable) &&
      (!config.X402_ENABLED || (config.paymentReady && options.startupPreflightPassed === true));
    response.status(healthy ? 200 : 503).json({
      name: "LaunchProof",
      version: "1.0.0",
      build_commit: config.BUILD_COMMIT_SHA,
      timestamp: new Date().toISOString(),
      dependencies: {
        x402: config.paymentReady
          ? options.startupPreflightPassed ? "startup_preflight_ready" : "configured_not_probed"
          : "not_ready",
        registry: registryReachable ? "reachable" : config.chainReady ? "unreachable" : "not_configured",
        database: databaseReachable ? (config.DATABASE_URL ? "reachable" : "memory_cache") : "unreachable",
      },
    });
  }));

  app.get("/.well-known/launchproof.json", freeLimiter, (_request, response) => response.json(projectCard(config)));

  app.post("/api/rehearsals", asyncRoute(async (request, response) => {
    const body = requestSchema.parse(request.body);
    if (body.previous_run_id) throw new HttpError(400, "Use /api/renewals when previous_run_id is supplied");
    const run = await service.reserve(body.url, body.idempotency_key, "genesis", null);
    if (run.state === "payment_required" && isAuthorizedLocalRun(request, config)) {
      const payment = await launchPaymentReference(request, response, "0.01", "/api/rehearsals", config);
      await service.runReserved(run.run_id, { url: body.url, idempotency_key: body.idempotency_key, payment }, false);
    }
    response.status("canonical_evidence" in run ? 200 : 202).location(`/runs/${run.run_id}`).json(run);
  }));

  app.post("/api/renewals", asyncRoute(async (request, response) => {
    const body = requestSchema.parse(request.body);
    if (!body.previous_run_id) throw new HttpError(400, "previous_run_id is required");
    const run = await service.reserve(body.url, body.idempotency_key, "renewal", body.previous_run_id);
    if (run.state === "payment_required" && isAuthorizedLocalRun(request, config)) {
      const payment = await launchPaymentReference(request, response, "0.10", "/api/renewals", config);
      await service.runReserved(
        run.run_id,
        { url: body.url, idempotency_key: body.idempotency_key, payment, previous_run_id: body.previous_run_id },
        false,
      );
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
    const chainRun = config.chainReady ? await registry.readPublishedRun(runId, cached && "canonical_evidence" in cached ? cached : null) : null;
    const run = config.chainReady
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
    const run = config.chainReady && (!cached || "canonical_evidence" in cached)
      ? await registry.readPublishedRun(payment.run_id, cached && "canonical_evidence" in cached ? cached : null)
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
      explorer_url: payment.settlement_transaction ? `${config.chain.explorerUrl}/tx/${payment.settlement_transaction}` : null,
      run_url: `${config.PUBLIC_WEB_BASE_URL}/passport/${payment.run_id}`,
      chain_run_linkage_matches: chainRunLinkageMatches,
    });
  }));

  app.get("/status", freeLimiter, asyncRoute(async (_request, response) => {
    response.json({
      observed_at: new Date().toISOString(),
      service: config.paymentReady && config.chainReady && config.chain.testnet
        ? "testnet_ready"
        : "configuration_incomplete",
      listing: config.OKX_AI_LISTING_URL ? "published" : "not_configured",
      chain: publicChainPolicy(config),
      payments: publicPaymentPolicy(config),
      deployment: { backend_replicas: config.BACKEND_REPLICA_COUNT, model: "single-replica" },
      prices: { genesis_rehearsal: "0.01 USD₮0", renew_passport: "0.10 USD₮0" },
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
    const requestId = String(response.locals.requestId ?? "unknown");
    if (status === 500) {
      process.stderr.write(`${JSON.stringify({
        event: "request_error",
        request_id: requestId,
        error_type: error instanceof Error ? error.name.slice(0, 80) : "unknown",
      })}\n`);
      response.status(500).json({ error: "internal_error", request_id: requestId });
      return;
    }
    const message = error instanceof Error ? error.message.slice(0, 500) : "Request failed";
    response.status(status).json({ error: "request_failed", message, request_id: requestId });
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

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
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
    tools: ["rehearse_launch_contract"],
    compatibility_tools: ["preflight_service"],
    public_mcp_endpoint: `${api}/mcp/public`,
    public_tools: ["get_service_passport"],
    public_compatibility_tools: ["get_run"],
    price_usdt: GENESIS_AMOUNT,
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
    chain: publicChainPolicy(config),
    payments: publicPaymentPolicy(config),
    deployment: { backend_replicas: config.BACKEND_REPLICA_COUNT, model: "single-replica" },
    network: config.chain.network,
    settlement_asset: "USD₮0",
    settlement_asset_address: config.chain.usdt0Address,
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
  const fixtures: ReadonlyArray<readonly [string, string]> = [
    ["healthy", "All gates pass, including paid delivery"],
    ["invalid-output", "fresh_challenge fails with invalid_output"],
    ["schema-drift", "contract_correct or fresh_challenge fails with schema_drift"],
    ["timeout", "the relevant gate fails with timeout"],
  ];
  return fixtures.map(([variant, intendedOutcome]) => ({
    variant,
    label: "fixture",
    launch_contract: config.fixtureUrls[variant as keyof Config["fixtureUrls"]]
      ? manifestEndpoint(config.fixtureUrls[variant as keyof Config["fixtureUrls"]]!)
      : null,
    health: config.fixtureUrls[variant as keyof Config["fixtureUrls"]]
      ? new URL("/healthz", config.fixtureUrls[variant as keyof Config["fixtureUrls"]]!).toString()
      : null,
    source: `${config.SOURCE_REPOSITORY}/tree/${config.BUILD_COMMIT_SHA}/fixtures/invoice-normalizer-${variant}`,
    declaration_address: config.fixtureAddresses[variant as keyof Config["fixtureAddresses"]] ?? null,
    intended_outcome: intendedOutcome,
  }));
}

function publicChainPolicy(config: Config) {
  return {
    id: config.chain.id,
    chain_id: config.chain.id,
    network: config.chain.network,
    name: config.chain.name,
    testnet: config.chain.testnet,
    rpc_url: config.chain.rpcUrl ?? null,
    explorer_url: config.chain.explorerUrl,
    registry_address: config.REGISTRY_ADDRESS ?? null,
    registry_deployment_block: config.REGISTRY_DEPLOYMENT_BLOCK.toString(),
    registry_runtime_code_hash: config.REGISTRY_RUNTIME_CODE_HASH ?? null,
    usdt0_address: config.chain.usdt0Address,
    usdt0_decimals: config.chain.usdt0Decimals,
  };
}

function publicPaymentPolicy(config: Config) {
  return {
    x402_enabled: config.X402_ENABLED,
    payment_ready: config.paymentReady,
    local_unpaid_enabled: config.ALLOW_LOCAL_UNPAID_RUNS,
    asset: { symbol: "USD₮0", address: config.chain.usdt0Address, decimals: config.chain.usdt0Decimals },
    pay_to: config.PAYOUT_ADDRESS ?? null,
    genesis_amount: GENESIS_AMOUNT,
    genesis_amount_atomic: GENESIS_AMOUNT_ATOMIC,
    renewal_amount: RENEWAL_AMOUNT,
    renewal_amount_atomic: RENEWAL_AMOUNT_ATOMIC,
  };
}

function mcpArguments(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  return (body as { params?: { arguments?: unknown } }).params?.arguments ?? body;
}

function allowedOrigin(origin: string, allowed: ReadonlySet<string>): boolean {
  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function manifestEndpoint(base: string): string {
  const url = new URL(base);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/.well-known/launch-contract.json";
  return url.toString();
}
