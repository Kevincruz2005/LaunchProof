import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { assertRuntimeBytecode, runtimeBytecodeMatches } from "../src/chain/registry.js";
import { isPublicAddress, validateTargetUrl } from "../src/security/network.js";
import { sanitizeOutboundHeaders, validateSafeRedirect } from "../src/security/safe-fetch.js";

describe("SSRF boundary", () => {
  it.each(["0.0.0.0", "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("permits globally routable addresses", () => expect(isPublicAddress("1.1.1.1")).toBe(true));
  it("rejects credentials, local names, HTTP, and unusual ports", () => {
    expect(() => validateTargetUrl("http://example.com")).toThrow();
    expect(() => validateTargetUrl("https://user:pass@example.com")).toThrow();
    expect(() => validateTargetUrl("https://service.local")).toThrow();
    expect(() => validateTargetUrl("https://service.local./resource")).toThrow();
    expect(() => validateTargetUrl("https://localhost./resource")).toThrow();
    expect(() => validateTargetUrl("https://metadata.home.arpa/resource")).toThrow();
    expect(() => validateTargetUrl("https://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => validateTargetUrl("https://127.1/resource")).toThrow();
    expect(() => validateTargetUrl("https://2130706433/resource")).toThrow();
    expect(() => validateTargetUrl("https://0x7f000001/resource")).toThrow();
    expect(() => validateTargetUrl("https://[::ffff:127.0.0.1]/resource")).toThrow();
    expect(() => validateTargetUrl("https://example.com:8443")).toThrow();
  });
  it("allows only same-origin GET redirects and never redirects a payment POST", () => {
    expect(() => validateSafeRedirect(new URL("https://a.example/start"), new URL("https://b.example/end"), "GET")).toThrow(/Cross-origin/);
    expect(() => validateSafeRedirect(new URL("https://a.example/start"), new URL("https://a.example/end"), "POST")).toThrow(/POST/);
    expect(() => validateSafeRedirect(new URL("https://a.example/start"), new URL("https://a.example/end"), "GET")).not.toThrow();
  });

  it("allows only protocol headers required by MCP and x402 outbound requests", () => {
    expect(sanitizeOutboundHeaders({ "Payment-Signature": "signed", "mcp-session-id": "session" })).toEqual({
      "payment-signature": "signed",
      "mcp-session-id": "session",
    });
    for (const name of ["authorization", "cookie", "host", "x-forwarded-for", "access-control-expose-headers", "content-length"]) {
      expect(() => sanitizeOutboundHeaders({ [name]: "unsafe" })).toThrow(/not permitted/i);
    }
    expect(() => sanitizeOutboundHeaders({ accept: "application/json\r\nx-injected: true" })).toThrow(/control characters/i);
  });
});

describe("registry runtime identity", () => {
  it("accepts only the exact configured runtime bytecode hash", () => {
    const runtime = "0x6001600055" as const;
    const expected = keccak256(runtime);
    expect(runtimeBytecodeMatches(runtime, expected)).toBe(true);
    expect(runtimeBytecodeMatches("0x6002600055", expected)).toBe(false);
    expect(runtimeBytecodeMatches("0x", expected)).toBe(false);
    expect(() => assertRuntimeBytecode("0x6002600055", expected)).toThrow(/runtime bytecode mismatch/i);
  });
});
