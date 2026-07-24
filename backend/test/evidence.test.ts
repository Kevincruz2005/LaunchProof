import { describe, expect, it } from "vitest";
import { hashJcs, sha256, toJcs } from "../src/evidence/canonical.js";
import { configuredFixtureMatch } from "../src/evidence/validate.js";

const provider = "0x72533424FbC2a174a5745e0c440994997F1CD6d1";
const fixtureConfig = {
  fixtureUrls: {
    healthy: "https://candidate.example/.well-known/launch-contract.json",
    invalidOutput: undefined,
    schemaDrift: undefined,
    timeout: undefined,
  },
  fixtureAddresses: {
    healthy: provider,
    invalidOutput: undefined,
    schemaDrift: undefined,
    timeout: undefined,
  },
};

describe("canonical evidence", () => {
  it("sorts object keys deterministically", () => {
    expect(toJcs({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    expect(hashJcs({ z: 1, a: 2 })).toBe(hashJcs({ a: 2, z: 1 }));
  });

  it("matches a known SHA-256 vector", () => {
    expect(sha256("abc")).toBe("0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("keeps writer fixture trust bound to the configured origin and identity", () => {
    expect(configuredFixtureMatch(
      { ...fixtureConfig, readOnly: false },
      "https://candidate.example/.well-known/launch-contract.json",
      provider,
    )).toBe(true);
    expect(configuredFixtureMatch(
      { ...fixtureConfig, readOnly: false },
      "https://historical.example/.well-known/launch-contract.json",
      provider,
    )).toBe(false);
  });

  it("lets read-only verification recognize a historical host only through the stable configured identity", () => {
    expect(configuredFixtureMatch(
      { ...fixtureConfig, readOnly: true },
      "https://historical.example/.well-known/launch-contract.json",
      provider,
    )).toBe(true);
    expect(configuredFixtureMatch(
      { ...fixtureConfig, readOnly: true },
      "https://historical.example/.well-known/launch-contract.json",
      "0x08254c2980C69e32B713857eB893b847aB5A5CC8",
    )).toBe(false);
  });
});
