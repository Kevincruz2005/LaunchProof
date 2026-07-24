import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeGateBitmap,
  encodeGateBitmap,
  formatAtomicAmount,
  hashJcs,
  normalizePublicHttpsUrl,
  parseDisplayAmount,
  toJcs,
  validatePassportGateConfig,
  type GateResults,
} from "../src/index.js";

describe("PassportGate property and fuzz invariants", () => {
  it("round-trips all five gate values through the sparse registry bitmap", () => {
    fc.assert(
      fc.property(fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()), (values) => {
        const gates: GateResults = {
          discoverable: values[0],
          contract_correct: values[1],
          fresh_challenge: values[2],
          safe_to_rehearse: values[3],
          paid_delivery: values[4],
        };
        expect(decodeGateBitmap(encodeGateBitmap(gates))).toEqual(gates);
      }),
    );
  });

  it("maps all 32 gate truth-table rows to all-pass only when every bit is true", () => {
    for (let bitmap = 0n; bitmap < 1n << 10n; bitmap += 1n) {
      const gates = decodeGateBitmap(bitmap);
      const allPass = Object.values(gates).every(Boolean);
      expect(allPass).toBe((bitmap & 0x155n) === 0x155n);
    }
  });

  it("canonicalizes equivalent object insertion orders identically", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.jsonValue()), (record) => {
        const entries = Object.entries(record);
        const forward = Object.fromEntries(entries);
        const reverse = Object.fromEntries([...entries].reverse());
        expect(toJcs(forward)).toBe(toJcs(reverse));
        expect(hashJcs(forward)).toBe(hashJcs(reverse));
      }),
      { numRuns: 250 },
    );
  });

  it("produces deterministic hashes for arbitrary JSON evidence", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(hashJcs(value)).toBe(hashJcs(JSON.parse(JSON.stringify(value))));
      }),
      { numRuns: 250 },
    );
  });

  it("normalizes host case and the default HTTPS port without changing identity", () => {
    fc.assert(
      fc.property(
        fc.domain(),
        fc.array(fc.stringMatching(/^[a-z0-9_-]{1,12}$/), { minLength: 0, maxLength: 4 }),
        (domain, segments) => {
          const path = segments.map(encodeURIComponent).join("/");
          const suffix = path ? `/${path}` : "/";
          expect(normalizePublicHttpsUrl(`https://${domain.toUpperCase()}:443${suffix}`)).toBe(
            normalizePublicHttpsUrl(`https://${domain}${suffix}`),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects unsafe schemes, credentials, ports, queries, fragments, and private literals", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "http://example.com/contract.json",
          "https://user:pass@example.com/contract.json",
          "https://example.com:8443/contract.json",
          "https://example.com/contract.json?x=1",
          "https://example.com/contract.json#x",
          "https://localhost/contract.json",
          "https://127.0.0.1/contract.json",
          "https://10.0.0.1/contract.json",
          "https://[::1]/contract.json",
          "https://service.internal/contract.json",
        ),
        (url) => {
          expect(() => normalizePublicHttpsUrl(url)).toThrow();
        },
      ),
    );
  });

  it("round-trips atomic token values and decimals without floating-point arithmetic", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 36n }), fc.integer({ min: 0, max: 24 }), (amount, decimals) => {
        expect(parseDisplayAmount(formatAtomicAmount(amount, decimals), decimals)).toBe(amount);
      }),
      { numRuns: 500 },
    );
  });

  it("permits only loopback HTTP output links in explicit local mode", () => {
    const base = {
      chainId: 1952 as const,
      network: "eip155:1952" as const,
      assetAddress: "0x1111111111111111111111111111111111111111" as const,
      assetDecimals: 6,
      defaultWarnAgeHours: 24,
      defaultMaxAgeHours: 72,
      explorerBaseUrl: "https://explorer.example.com",
      passportBaseUrl: "http://localhost:3000",
      rehearsalBaseUrl: "http://127.0.0.1:3000",
      deploymentMode: "local" as const,
    };
    expect(validatePassportGateConfig(base)).toMatchObject({ deploymentMode: "local" });
    expect(() => validatePassportGateConfig({ ...base, passportBaseUrl: "http://private.example.com" })).toThrow();
  });
});
