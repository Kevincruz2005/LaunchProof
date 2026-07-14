import { describe, expect, it } from "vitest";
import { encodePaymentResponseHeader } from "@okxweb3/x402-core/http";
import type { Request, Response } from "express";
import { loadConfig } from "../src/config.js";
import { launchPaymentReference } from "../src/payments/inbound.js";

describe("settled LaunchProof payment references", () => {
  it("binds the official final settlement transaction and payer", () => {
    const transaction = `0x${"ab".repeat(32)}`;
    const payer = `0x${"12".repeat(20)}`;
    const header = encodePaymentResponseHeader({ success: true, status: "success", transaction, network: "eip155:196", payer });
    const base = loadConfig({ NODE_ENV: "test" });
    const config = {
      ...base,
      productionReady: true,
      PAYOUT_ADDRESS: `0x${"34".repeat(20)}`,
    } as typeof base;
    const request = { header: () => "signed-payment" } as unknown as Request;
    const response = { getHeader: (name: string) => name.toLowerCase() === "payment-response" ? header : undefined } as unknown as Response;
    const reference = launchPaymentReference(request, response, "0.01", "/api/rehearsals", config);
    expect(reference.payment_id).toBe(transaction);
    expect(reference.settlement_transaction).toBe(transaction);
    expect(reference.payer).toBe(payer);
    expect(reference.status).toBe("settled");
  });

  it("fails closed when production settlement has no transaction", () => {
    const base = loadConfig({ NODE_ENV: "test" });
    const config = { ...base, productionReady: true, PAYOUT_ADDRESS: `0x${"34".repeat(20)}` } as typeof base;
    const request = { header: () => undefined } as unknown as Request;
    const response = { getHeader: () => undefined } as unknown as Response;
    expect(() => launchPaymentReference(request, response, "0.01", "/api/rehearsals", config)).toThrow(/settlement transaction/);
  });
});
