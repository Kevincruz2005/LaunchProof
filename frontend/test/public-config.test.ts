import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("frontend public configuration", () => {
  it("requires both public bases outside tests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_WEB_BASE_URL", "");
    await expect(import("../lib/public-config.js")).rejects.toThrow(/NEXT_PUBLIC_API_BASE_URL must be configured/);
  });

  it("rejects non-loopback HTTP deployment values", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.example.test");
    vi.stubEnv("NEXT_PUBLIC_WEB_BASE_URL", "https://web.example.test");
    await expect(import("../lib/public-config.js")).rejects.toThrow(/must use HTTPS outside local development/);
  });

  it("normalizes configured HTTPS bases without inventing deployment values", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.launchproof.dev/");
    vi.stubEnv("NEXT_PUBLIC_WEB_BASE_URL", "https://web.launchproof.dev/");
    stubProductionAnchors();
    const config = await import("../lib/public-config.js");
    expect(config.PUBLIC_API_BASE).toBe("https://api.launchproof.dev");
    expect(config.PUBLIC_WEB_BASE).toBe("https://web.launchproof.dev");
    expect(config.PUBLIC_CHAIN_ANCHORS.chainId).toBe(1952);
  });

  it("refuses mainnet, unknown-network, local RPC, and zero-address build anchors", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.launchproof.dev");
    vi.stubEnv("NEXT_PUBLIC_WEB_BASE_URL", "https://web.launchproof.dev");
    stubProductionAnchors();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "1");
    await expect(import("../lib/public-config.js")).rejects.toThrow(/testnet chain 1952/i);

    vi.resetModules();
    stubProductionAnchors();
    vi.stubEnv("NEXT_PUBLIC_XLAYER_RPC_URL", "http://127.0.0.1:8545");
    await expect(import("../lib/public-config.js")).rejects.toThrow(/public, non-placeholder HTTPS/i);

    vi.resetModules();
    stubProductionAnchors();
    vi.stubEnv("NEXT_PUBLIC_REGISTRY_ADDRESS", `0x${"0".repeat(40)}`);
    await expect(import("../lib/public-config.js")).rejects.toThrow(/nonzero EVM address/i);
  });
});

function stubProductionAnchors(): void {
  vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "1952");
  vi.stubEnv("NEXT_PUBLIC_XLAYER_RPC_URL", "https://testrpc.xlayer.tech/terigon");
  vi.stubEnv("NEXT_PUBLIC_REGISTRY_ADDRESS", `0x${"1".repeat(40)}`);
  vi.stubEnv("NEXT_PUBLIC_PAYOUT_ADDRESS", `0x${"2".repeat(40)}`);
  vi.stubEnv("NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK", "1");
  vi.stubEnv("NEXT_PUBLIC_SOURCE_REPOSITORY", "https://github.com/tests/launchproof");
}
