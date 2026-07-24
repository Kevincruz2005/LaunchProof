import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkServicePassport, getControlledFixtures } from "../lib/generated-api/client.js";

afterEach(() => vi.unstubAllGlobals());

describe("Judge Mode API client", () => {
  it("loads fixture URLs only from the backend catalog", async () => {
    const launchContract = "https://runtime-catalog.example.test/.well-known/launch-contract.json";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ fixtures: [{
      variant: "healthy",
      label: "fixture",
      launch_contract: launchContract,
      health: "https://runtime-catalog.example.test/healthz",
      source: "https://source.example.test/tree/revision/fixture",
      declaration_address: `0x${"11".repeat(20)}`,
      intended_outcome: "All gates pass",
    }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getControlledFixtures()).resolves.toEqual([expect.objectContaining({ launch_contract: launchContract })]);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/fixtures$/);
  });

  it("preserves typed 503 unavailability instead of throwing or returning BLOCK", async () => {
    const unavailable = {
      error: "verification_unavailable",
      retry_safe: true,
      operational_status: "UNAVAILABLE",
      decision: null,
      reason_codes: ["RPC_TIMEOUT"],
      explanation: "RPC timed out.",
      observed_at: "2026-07-20T12:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(unavailable), { status: 503 })));
    await expect(checkServicePassport("https://service.example.test")).resolves.toEqual(unavailable);
  });

  it("fails closed when a 200 response does not satisfy the decision contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ decision: "ALLOW" }), { status: 200 })));
    await expect(checkServicePassport("https://service.example.test")).rejects.toThrow(/invalid decision contract/);
  });

  it("keeps Judge Mode responsive rules in the production stylesheet", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("@media (max-width: 1050px)");
    expect(css).toContain(".judge-console { grid-template-columns: 1fr;");
    expect(css).toContain("@media (max-width: 440px)");
    expect(css).toContain(".judge-gates { grid-template-columns: 1fr;");
  });
});
