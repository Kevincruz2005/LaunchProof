import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertTestnetPaymentAnchors,
  filterExactPaymentRequirements,
  type ProjectCard,
} from "../lib/generated-api/client.js";

const payout = `0x${"11".repeat(20)}` as `0x${string}`;
const registry = `0x${"22".repeat(20)}` as `0x${string}`;
const asset = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c" as const;
const rpc = "https://testrpc.xlayer.tech/terigon";

function projectCard(): ProjectCard {
  return {
    name: "LaunchProof",
    build_commit: "a".repeat(40),
    source_commit: "a".repeat(40),
    chain: {
      id: 1952,
      network: "eip155:1952",
      name: "X Layer Testnet",
      testnet: true,
      rpc_url: rpc,
      explorer_url: "https://www.okx.com/web3/explorer/xlayer-test",
      registry_address: registry,
      registry_deployment_block: "123",
      registry_runtime_code_hash: `0x${"33".repeat(32)}`,
      usdt0_address: asset,
      usdt0_decimals: 6,
    },
    payments: {
      x402_enabled: true,
      payment_ready: true,
      local_unpaid_enabled: false,
      asset: { symbol: "USD₮0", address: asset, decimals: 6 },
      pay_to: payout,
      genesis_amount: "0.01",
      genesis_amount_atomic: "10000",
      renewal_amount: "0.10",
      renewal_amount_atomic: "100000",
    },
  };
}

describe("frontend testnet payment policy", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_PAYOUT_ADDRESS = payout;
    process.env.NEXT_PUBLIC_CHAIN_ID = "1952";
    process.env.NEXT_PUBLIC_XLAYER_RPC_URL = rpc;
    process.env.NEXT_PUBLIC_REGISTRY_ADDRESS = registry;
    process.env.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK = "123";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_PAYOUT_ADDRESS;
    delete process.env.NEXT_PUBLIC_CHAIN_ID;
    delete process.env.NEXT_PUBLIC_XLAYER_RPC_URL;
    delete process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
    delete process.env.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK;
  });

  it("accepts only the exact X Layer testnet public anchors", () => {
    expect(() => assertTestnetPaymentAnchors(projectCard())).not.toThrow();
    expect(() => assertTestnetPaymentAnchors({
      ...projectCard(),
      chain: { ...projectCard().chain, id: 196, network: "eip155:196" },
    })).toThrow(/1952/);
  });

  it("rejects a project-card recipient that differs from the build anchor", () => {
    const card = projectCard();
    card.payments.pay_to = `0x${"44".repeat(20)}`;
    expect(() => assertTestnetPaymentAnchors(card)).toThrow(/recipient/);
  });

  it("filters the 402 challenge by scheme, network, token, amount, and recipient", () => {
    const exact = {
      scheme: "exact",
      network: "eip155:1952" as const,
      asset,
      amount: "10000",
      payTo: payout,
      maxTimeoutSeconds: 60,
      extra: {},
    };
    expect(filterExactPaymentRequirements([exact], exact)).toEqual([exact]);
    expect(() => filterExactPaymentRequirements(
      [{ ...exact, amount: "10001" }],
      exact,
    )).toThrow(/did not exactly match/);
  });
});
