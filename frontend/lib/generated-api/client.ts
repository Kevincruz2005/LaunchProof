export type GateState = "pass" | "fail" | "not_tested";
export type PassportStatus = "verified" | "needs-attention" | "not-rehearsable";

export interface RunProgress {
  run_id: string;
  state: string;
  error?: string | null;
}

export interface Passport extends RunProgress {
  label: "fixture" | "production" | "local_only";
  scope: string;
  passport_status: PassportStatus;
  gates: Record<string, GateState>;
  evidence_hash: string;
  manifest_hash: string;
  input_hash: string;
  normalized_result_hash: string;
  source_version_sha: string;
  build_commit_sha: string;
  generated_at: string;
  provider_declaration: {
    provider_address: string;
    verification_state: "verified" | "not_provided" | "invalid";
  };
  payment: { payment_id: string; amount: string; settlement_transaction: string | null; status: string };
  target_payment: { payment_id: string; settlement_transaction: string | null } | null;
  chain: { published: boolean; evidence_transaction_hash: string; explorer_url: string; registry_address: string };
  canonical_evidence: Record<string, unknown>;
  remediation: string[];
  limitations: string[];
  previous_run_id: string | null;
}

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function pollRun(runId: string, onUpdate: (run: RunProgress) => void): Promise<Passport> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
    const run = (await response.json()) as RunProgress | Passport;
    onUpdate(run);
    if (response.ok && (run.state === "complete" || run.state === "complete_local")) return run as Passport;
    if (run.state === "failed") throw new Error(run.error ?? "Rehearsal failed");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The run is still processing. Its link remains safe to revisit.");
}

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
    };
  }
}

export async function connectWallet(): Promise<`0x${string}`> {
  if (!window.ethereum) throw new Error("Install or open an EVM wallet to approve the x402 payment.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("The wallet did not return an account.");
  const TARGET_CHAIN_ID = Number.parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "196", 10);
  const targetChainHex = `0x${TARGET_CHAIN_ID.toString(16)}`;
  const chainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  if (Number.parseInt(chainId, 16) !== TARGET_CHAIN_ID) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] });
    } catch {
      const rpc = process.env.NEXT_PUBLIC_XLAYER_RPC_URL;
      if (!rpc) throw new Error(`Add X Layer (chain ${TARGET_CHAIN_ID}) to the wallet before continuing.`);
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: targetChainHex, chainName: TARGET_CHAIN_ID === 1952 ? "X Layer Testnet" : "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: [rpc], blockExplorerUrls: [TARGET_CHAIN_ID === 1952 ? "https://www.oklink.com/xlayer-test" : "https://www.oklink.com/xlayer"] }],
      });
    }
  }
  return account as `0x${string}`;
}

export async function submitPaidRun(input: {
  url: string;
  previousRunId?: string;
  idempotencyKey: string;
  localOnly: boolean;
  account?: `0x${string}`;
}): Promise<RunProgress> {
  const route = input.previousRunId ? "/api/renewals" : "/api/rehearsals";
  const body = JSON.stringify({
    url: input.url,
    idempotency_key: input.idempotencyKey,
    ...(input.previousRunId ? { previous_run_id: input.previousRunId } : {}),
  });
  let response: Response;
  if (input.localOnly) {
    response = await fetch(`${API_BASE}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-launchproof-local-run": "true", "idempotency-key": input.idempotencyKey },
      body,
    });
  } else {
    if (!window.ethereum || !input.account) throw new Error("Connect a wallet before approving payment.");
    const TARGET_CHAIN_ID = Number.parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "196", 10);
    const networkEip = `eip155:${TARGET_CHAIN_ID}` as `${string}:${string}`;
    const [{ createWalletClient, custom }, { xLayer, xLayerTestnet }, { ExactEvmScheme, toClientEvmSigner }, { wrapFetchWithPaymentFromConfig }] =
      await Promise.all([import("viem"), import("viem/chains"), import("@okxweb3/x402-evm"), import("@okxweb3/x402-fetch")]);
    const chain = TARGET_CHAIN_ID === 1952 ? xLayerTestnet : xLayer;
    const wallet = createWalletClient({ account: input.account, chain, transport: custom(window.ethereum) });
    const signer = toClientEvmSigner({
      address: input.account,
      signTypedData: async (message) =>
        wallet.signTypedData({
          account: input.account!,
          domain: message.domain,
          types: message.types,
          primaryType: message.primaryType,
          message: message.message,
        } as Parameters<typeof wallet.signTypedData>[0]),
    });
    const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: networkEip, client: new ExactEvmScheme(signer) }],
      policies: [(_version, requirements) => requirements.filter((item) => item.network === networkEip && item.scheme === "exact")],
    });
    response = await paidFetch(`${API_BASE}${route}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey }, body });
  }
  const payload = (await response.json()) as RunProgress & { message?: string; detail?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.detail ?? `Request failed (${response.status})`);
  return payload;
}
