import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { LaunchContractSchema, parseLaunchContract } from "../src/launch-contract/schema.js";

const valid = {
  contract_version: "1.0",
  service_name: "Invoice normalizer",
  mcp_endpoint: "https://fixture.example/mcp",
  tool: "normalize_invoice",
  mode: "sample_only",
  sample_input: { invoice_text: "Invoice #101" },
  assertions: [{ path: "$.invoice_number", rule: "equals", value: "101" }],
  max_latency_ms: 8000,
  delivery_type: "synchronous_json",
  payment_mode: "none",
  safe_use: [
    "tool is read-only for synthetic sample data",
    "no credentials or account",
    "no tool side effect beyond the declared x402 payment",
  ],
  source_revision: "a".repeat(40),
  challenge_profile: {
    name: "structured-extraction-v1",
    tool: "normalize_invoice",
    input_field: "document_text",
    output_fields: ["document_id", "currency", "total", "due_date"],
    challenge_runs: 3,
    max_latency_ms_per_run: 8000,
    safe_mode: "synthetic_read_only",
  },
  provider_address: "0x0000000000000000000000000000000000000001",
};

describe("Launch Contract schema", () => {
  it("accepts the locked profile", () => expect(LaunchContractSchema.parse(valid).contract_version).toBe("1.0"));
  it("rejects unknown assertion rules", () => expect(() => LaunchContractSchema.parse({ ...valid, assertions: [{ path: "$.x", rule: "contains", value: "x" }] })).toThrow());
  it("rejects manifest-controlled regular expressions", () => expect(() => LaunchContractSchema.parse({
    ...valid,
    assertions: [{ path: "$.x", rule: "regex", value: "(a+)+$" }],
  })).toThrow());
  it("rejects nested sample and assertion values before canonicalization", () => {
    expect(() => LaunchContractSchema.parse({ ...valid, sample_input: { invoice_text: { deeply: ["nested"] } } })).toThrow();
    expect(() => LaunchContractSchema.parse({
      ...valid,
      assertions: [{ path: "$.x", rule: "equals", value: { deeply: ["nested"] } }],
    })).toThrow();
  });
  it("requires exactly three fresh challenges", () => expect(() => LaunchContractSchema.parse({ ...valid, challenge_profile: { ...valid.challenge_profile, challenge_runs: 2 } })).toThrow());
  it("rejects HTTP endpoints", () => expect(() => LaunchContractSchema.parse({ ...valid, mcp_endpoint: "http://fixture.example/mcp" })).toThrow());
  it("rejects credential-bearing or tokenized endpoint URLs", () => {
    expect(() => LaunchContractSchema.parse({ ...valid, mcp_endpoint: "https://user:secret@fixture.example/mcp" })).toThrow();
    expect(() => LaunchContractSchema.parse({ ...valid, mcp_endpoint: "https://fixture.example/mcp?token=secret" })).toThrow();
    expect(() => LaunchContractSchema.parse({ ...valid, mcp_endpoint: "https://fixture.example/mcp#secret" })).toThrow();
  });
  it("requires signed payment terms when x402 is advertised", () => expect(() => LaunchContractSchema.parse({ ...valid, payment_mode: "x402_optional" })).toThrow());
  it("rejects unknown fields", () => expect(() => LaunchContractSchema.parse({ ...valid, credentials: "send me a key" })).toThrow());
  it("rejects a positive side-effect claim hidden beside negative safety language", () => expect(() => LaunchContractSchema.parse({
    ...valid,
    safe_use: [...valid.safe_use, "writes production records"],
  })).toThrow(/safe_use/));
  it("rejects output fields unsupported by the deterministic challenge generator", () => expect(() => LaunchContractSchema.parse({
    ...valid,
    challenge_profile: { ...valid.challenge_profile, output_fields: ["invented"] },
  })).toThrow(/output_fields/));
  it("rejects duplicate output fields", () => expect(() => LaunchContractSchema.parse({
    ...valid,
    challenge_profile: {
      ...valid.challenge_profile,
      output_fields: ["document_id", "currency", "total", "due_date", "due_date"],
    },
  })).toThrow(/output_fields/));

  it("refuses credential-like signed content before it can become public evidence", () => {
    expect(() => LaunchContractSchema.parse({ ...valid, sample_input: { api_key: "do-not-publish" } })).toThrow(/credential-like/);
    expect(() => LaunchContractSchema.parse({ ...valid, sample_input: { invoice_text: "Bearer secret-token" } })).toThrow(/credential-like/);
    expect(() => LaunchContractSchema.parse({ ...valid, assertions: [{
      path: "$.invoice_number",
      rule: "equals",
      value: `0x${"ab".repeat(32)}`,
    }] })).toThrow(/credential-like/);
  });

  it("binds x402 terms to the active X Layer testnet profile", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    const paid = {
      ...valid,
      payment_mode: "x402_optional",
      payment: {
        network: config.chain.network,
        asset: config.chain.usdt0Address,
        amount: "10000",
        recipient: `0x${"22".repeat(20)}`,
        resource_url: "https://fixture.example/paid",
      },
    };
    expect(parseLaunchContract(paid, config).payment?.network).toBe("eip155:1952");
    expect(() => parseLaunchContract({
      ...paid,
      payment: { ...paid.payment, network: "eip155:196" },
    }, config)).toThrow(/payment network/);
  });
});
