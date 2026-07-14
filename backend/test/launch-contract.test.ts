import { describe, expect, it } from "vitest";
import { LaunchContractSchema } from "../src/launch-contract/schema.js";

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
  safe_use: ["read-only sample data", "no external side effect"],
  source_revision: "abc123",
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
  it("requires exactly three fresh challenges", () => expect(() => LaunchContractSchema.parse({ ...valid, challenge_profile: { ...valid.challenge_profile, challenge_runs: 2 } })).toThrow());
  it("rejects HTTP endpoints", () => expect(() => LaunchContractSchema.parse({ ...valid, mcp_endpoint: "http://fixture.example/mcp" })).toThrow());
  it("requires signed payment terms when x402 is advertised", () => expect(() => LaunchContractSchema.parse({ ...valid, payment_mode: "x402_optional" })).toThrow());
  it("rejects unknown fields", () => expect(() => LaunchContractSchema.parse({ ...valid, credentials: "send me a key" })).toThrow());
});
