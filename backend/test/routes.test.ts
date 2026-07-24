import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/rest/app.js";
import { MemoryRepository } from "../src/db/store.js";

const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_API_BASE_URL: "http://localhost:4000",
  PUBLIC_WEB_BASE_URL: "http://localhost:3000",
  BUILD_COMMIT_SHA: "test-commit",
  ALLOW_LOCAL_UNPAID_RUNS: "false",
});
const app = createApp(config);

describe("public and paid routes", () => {
  it("keeps health and project card free", async () => {
    expect((await request(app).get("/healthz")).status).toBe(200);
    const card = await request(app).get("/.well-known/launchproof.json");
    expect(card.status).toBe(200);
    expect(card.body.tools).toEqual(["rehearse_launch_contract"]);
    expect(card.body.public_tools).toEqual(["get_service_passport", "check_service_passport"]);
    expect(card.body.chain.network).toBe("eip155:1952");
    expect(card.body.payments.genesis_amount_atomic).toBe("10000");
  });

  it("does not silently simulate paid access", async () => {
    const response = await request(app).post("/api/rehearsals").send({ url: "https://example.com", idempotency_key: "abcdefgh" });
    expect(response.status).toBe(402);
    expect(response.body.local_only).toBe(true);
  });

  it("exposes the x402 challenge header to the browser", async () => {
    const response = await request(app)
      .post("/api/rehearsals")
      .set("Origin", "http://localhost:3000")
      .send({ url: "https://example.com", idempotency_key: "browser-cors-test" });
    expect(response.status).toBe(402);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-expose-headers"]?.toLowerCase().split(",")).toContain("payment-required");
  });

  it("permits x402 request headers but refuses the response-only expose header in preflight", async () => {
    const response = await request(app)
      .options("/api/rehearsals")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,idempotency-key,payment-signature,access-control-expose-headers");
    expect(response.status).toBe(204);
    const allowed = response.headers["access-control-allow-headers"]?.toLowerCase().split(",");
    expect(allowed).toContain("payment-signature");
    expect(allowed).not.toContain("access-control-expose-headers");
    expect(allowed).not.toContain("x-launchproof-local-run");
  });

  it("denies unknown browser origins and refuses a public unpaid-bypass header", async () => {
    const denied = await request(app)
      .options("/api/rehearsals")
      .set("Origin", "https://attacker.invalid")
      .set("Access-Control-Request-Method", "POST");
    expect(denied.status).toBe(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    const bypass = await request(app)
      .post("/api/rehearsals")
      .set("Origin", "http://localhost:3000")
      .set("x-launchproof-local-run", "true")
      .send({ url: "https://example.com", idempotency_key: "public-bypass-refusal" });
    expect(bypass.status).toBe(402);
    expect(bypass.body).not.toHaveProperty("canonical_evidence");
  });

  it("publishes the exact no-SLA disclaimer", async () => {
    const response = await request(app).get("/status");
    expect(response.body.disclaimer).toContain("It is not an uptime guarantee or a service-level agreement");
  });

  it("advertises both free Passport tools on the public MCP endpoint", async () => {
    const response = await request(app)
      .post("/mcp/public")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(response.status).toBe(200);
    expect(response.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "check_service_passport",
      "get_service_passport",
    ]);
  });

  it("serves OpenAPI with the deployed API origin and all public REST workflows", async () => {
    const response = await request(app).get("/schema/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.servers).toEqual([{ url: config.PUBLIC_API_BASE_URL }]);
    expect(Object.keys(response.body.paths)).toEqual(expect.arrayContaining([
      "/healthz", "/api/rehearsals", "/api/renewals", "/runs/{runId}", "/verify/{runId}", "/receipts/{paymentId}", "/status", "/fixtures",
    ]));
  });

  it("keeps the legacy get_run alias identical to get_service_passport", async () => {
    const repository = new MemoryRepository();
    await repository.createProgress({
      run_id: "local-alias-test",
      idempotency_key: "alias-test-key",
      state: "payment_required",
      target: "https://fixture.example",
      operation: "genesis",
      previous_run_id: null,
      payment: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
      error: null,
    });
    const aliasApp = createApp(config, repository);
    const call = (name: string) => request(aliasApp)
      .post("/mcp/public")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { run_id: "local-alias-test" } } });
    const [canonical, alias] = await Promise.all([call("get_service_passport"), call("get_run")]);
    expect(alias.status).toBe(200);
    expect(alias.body.result).toEqual(canonical.body.result);
  });

  it("returns all fixture fields without inventing undeployed addresses", async () => {
    const response = await request(app).get("/fixtures");
    expect(response.body.fixtures).toHaveLength(4);
    expect(response.body.fixtures.every((fixture: Record<string, unknown>) =>
      Object.hasOwn(fixture, "launch_contract") && Object.hasOwn(fixture, "declaration_address"),
    )).toBe(true);
  });

  it("rate-limits unpaid challenges by IP rather than an unverified payer header", async () => {
    const repository = new MemoryRepository();
    const limited = createApp(loadConfig({
      NODE_ENV: "test",
      PAID_RATE_LIMIT_PER_HOUR: "100",
      FREE_RATE_LIMIT_PER_MINUTE: "2",
    }), repository);
    const attempt = (index: number) => request(limited)
      .post("/api/rehearsals")
      .set("payment-signature", `fake-payer-${index}`)
      .send({ url: "https://example.com", idempotency_key: `unpaid-key-${index}` });
    expect((await attempt(1)).status).toBe(402);
    expect((await attempt(2)).status).toBe(402);
    expect((await attempt(3)).status).toBe(429);
    expect(await repository.getByIdempotencyKey("unpaid-key-1")).toBeNull();
  });

  it("does not expose internal exception messages in a 500 response", async () => {
    class FailingRepository extends MemoryRepository {
      override async healthCheck(): Promise<boolean> {
        throw new Error("DATABASE_URL=postgresql://user:supersecret@example.invalid/db");
      }
    }
    const response = await request(createApp(config, new FailingRepository())).get("/healthz");
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("supersecret");
    expect(response.body.request_id).toBeTruthy();
    expect(response.headers["x-request-id"]).toBe(response.body.request_id);
  });
});
