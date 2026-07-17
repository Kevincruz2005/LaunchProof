import { describe, expect, it } from "vitest";
import { isPublicAddress, validateTargetUrl } from "../src/security/network.js";
import { validateSafeRedirect } from "../src/security/safe-fetch.js";

describe("SSRF boundary", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("permits globally routable addresses", () => expect(isPublicAddress("1.1.1.1")).toBe(true));
  it("rejects credentials, local names, HTTP, and unusual ports", () => {
    expect(() => validateTargetUrl("http://example.com")).toThrow();
    expect(() => validateTargetUrl("https://user:pass@example.com")).toThrow();
    expect(() => validateTargetUrl("https://service.local")).toThrow();
    expect(() => validateTargetUrl("https://example.com:8443")).toThrow();
  });
  it("allows only same-origin GET redirects and never redirects a payment POST", () => {
    expect(() => validateSafeRedirect(new URL("https://a.example/start"), new URL("https://b.example/end"), "GET")).toThrow(/Cross-origin/);
    expect(() => validateSafeRedirect(new URL("https://a.example/start"), new URL("https://a.example/end"), "POST")).toThrow(/POST/);
    expect(() => validateSafeRedirect(new URL("https://a.example/start"), new URL("https://a.example/end"), "GET")).not.toThrow();
  });
});
