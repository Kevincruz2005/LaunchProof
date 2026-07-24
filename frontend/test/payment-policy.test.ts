import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertTestnetPaymentAnchors,
  apiGet,
  connectWallet,
  filterExactPaymentRequirements,
  forgetConnectedWallet,
  rememberConnectedWallet,
  restoreConnectedWallet,
  withoutResponseOnlyCorsHeaders,
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
    vi.unstubAllGlobals();
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

  it("silently restores an authorized wallet only from tab session storage", async () => {
    const stored = new Map<string, string>();
    const account = `0x${"55".repeat(20)}` as `0x${string}`;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x7a0";
      throw new Error(`Unexpected method ${method}`);
    });
    vi.stubGlobal("window", {
      okxwallet: { request },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });

    expect(await restoreConnectedWallet(projectCard())).toBeNull();
    expect(request).not.toHaveBeenCalled();
    rememberConnectedWallet(account);
    expect(await restoreConnectedWallet(projectCard())).toBe(account);
    expect(request.mock.calls.map(([input]) => input.method)).toEqual(["eth_accounts", "eth_chainId"]);
  });

  it("forgets restored storage on a newly opened app session", async () => {
    const stored = new Map([["launchproof.connected-wallet.v1", `0x${"55".repeat(20)}`]]);
    const request = vi.fn();
    vi.stubGlobal("window", {
      okxwallet: { request },
      performance: { getEntriesByType: () => [{ type: "navigate" }] },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    expect(await restoreConnectedWallet(projectCard())).toBeNull();
    expect(stored.size).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("revokes the existing permission before requesting a different OKX account", async () => {
    const stored = new Map<string, string>();
    const account = `0x${"66".repeat(20)}` as `0x${string}`;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_revokePermissions" || method === "wallet_requestPermissions") return [];
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0x7a0";
      throw new Error(`Unexpected method ${method}`);
    });
    vi.stubGlobal("window", {
      okxwallet: { request },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    expect(await connectWallet(projectCard(), true)).toBe(account);
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      "wallet_revokePermissions", "wallet_requestPermissions", "eth_requestAccounts", "eth_chainId",
    ]);
    rememberConnectedWallet(account);
    await forgetConnectedWallet();
    expect(stored.size).toBe(0);
    expect(request.mock.calls.at(-1)?.[0].method).toBe("wallet_revokePermissions");
  });

  it("reports a missing wallet without making a network or payment request", async () => {
    vi.stubGlobal("window", { sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
    await expect(connectWallet(projectCard(), true)).rejects.toThrow(/Install or unlock OKX Wallet/);
  });

  it("preserves wallet rejection and wrong-network rejection as user-visible failures", async () => {
    const rejected = Object.assign(new Error("User rejected the wallet request"), { code: 4001 });
    const permissionRequest = vi.fn().mockRejectedValue(rejected);
    vi.stubGlobal("window", { okxwallet: { request: permissionRequest } });
    await expect(connectWallet(projectCard(), true)).rejects.toBe(rejected);

    const account = `0x${"77".repeat(20)}`;
    const wrongChainRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0x1";
      if (method === "wallet_switchEthereumChain") throw rejected;
      throw new Error(`Unexpected method ${method}`);
    });
    vi.stubGlobal("window", { okxwallet: { request: wrongChainRequest } });
    await expect(connectWallet(projectCard())).rejects.toBe(rejected);
    expect(wrongChainRequest).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a0" }] });
  });

  it("removes the response-only CORS header from an OKX paid retry", async () => {
    const sent: Request[] = [];
    const safeFetch = withoutResponseOnlyCorsHeaders(async (input, init) => {
      sent.push(new Request(input, init));
      return new Response(null, { status: 202 });
    });
    const response = await safeFetch("https://api.example.test/paid", {
      method: "POST",
      headers: {
        "access-control-expose-headers": "PAYMENT-RESPONSE",
        "payment-signature": "signed-payload",
      },
    });
    expect(response.status).toBe(202);
    expect(sent[0]?.headers.has("access-control-expose-headers")).toBe(false);
    expect(sent[0]?.headers.get("payment-signature")).toBe("signed-payload");
  });

  it("retries a transient public API fetch before showing an error", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ match: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet<{ match: boolean }>("/verify/test-run")).resolves.toEqual({ match: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
