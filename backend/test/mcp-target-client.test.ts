import { describe, expect, it } from "vitest";
import { parseRpcPayload, parseToolDescription } from "../src/mcp/target-client.js";
import { schemaAcceptsBoundedInput } from "../src/workers/rehearsal.js";

describe("bounded MCP target protocol", () => {
  it("rejects stale IDs and non-2.0 JSON-RPC responses", () => {
    expect(() => parseRpcPayload(JSON.stringify({ jsonrpc: "2.0", id: 6, result: {} }), "application/json", 7))
      .toThrow(/ID did not match/);
    expect(() => parseRpcPayload(JSON.stringify({ jsonrpc: "1.0", id: 7, result: {} }), "application/json", 7))
      .toThrow(/JSON-RPC 2.0/);
  });

  it("rejects deeply nested or unsupported input schema objects before hashing", () => {
    let nested: unknown = "leaf";
    for (let index = 0; index < 2_000; index += 1) nested = { nested };
    expect(() => parseToolDescription({
      name: "normalize_invoice",
      inputSchema: {
        type: "object",
        properties: { invoice_text: { type: "string", maxLength: 1_000, unsupported: nested } },
        required: ["invoice_text"],
        additionalProperties: false,
      },
    })).toThrow(/unsupported fields/);
  });

  it("requires top-level required fields and one anyOf branch", () => {
    const schema = parseToolDescription({
      name: "normalize_invoice",
      inputSchema: {
        type: "object",
        properties: {
          tenant: { type: "string", maxLength: 40 },
          invoice_text: { type: "string", maxLength: 1_000 },
          document_text: { type: "string", maxLength: 1_000 },
        },
        required: ["tenant"],
        anyOf: [{ required: ["invoice_text"] }, { required: ["document_text"] }],
        additionalProperties: false,
      },
    }).inputSchema;
    expect(schemaAcceptsBoundedInput(schema, { tenant: "demo", invoice_text: "Invoice" })).toBe(true);
    expect(schemaAcceptsBoundedInput(schema, { invoice_text: "Invoice" })).toBe(false);
    expect(schemaAcceptsBoundedInput(schema, { tenant: "demo" })).toBe(false);
  });

  it("rejects duplicate tools and malformed schema branches at parsing boundaries", () => {
    expect(() => parseToolDescription({
      name: "normalize_invoice",
      inputSchema: {
        type: "object",
        properties: { invoice_text: { type: "string", maxLength: 1_000 } },
        anyOf: [{ required: ["invoice_text"], nested: {} }],
        additionalProperties: false,
      },
    })).toThrow(/unsupported fields/);
  });
});
