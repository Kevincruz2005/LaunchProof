import type { Network, PaymentRequirements } from "@okxweb3/x402-fetch";
import { PUBLIC_API_BASE } from "../public-config";

export type GateState = "pass" | "fail" | "not_tested";
export type PassportStatus = "verified" | "needs-attention" | "not-rehearsable";
export type PaymentMode = "paid" | "local";

export interface RunProgress {
  run_id: string;
  state: string;
  error?: string | null;
}

export interface PaymentReference {
  payment_id: string;
  kind?: "launchproof" | "target";
  amount: string;
  amount_atomic?: string;
  amount_display?: string;
  asset_decimals?: number;
  asset: string;
  network: string;
  payer?: string | null;
  recipient?: string | null;
  route?: string;
  settlement_transaction: string | null;
  status: "settled" | "not_tested" | "local_only" | string;
  timestamp?: string;
}

export interface Passport extends RunProgress {
  label: "fixture" | "external";
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
  payment: PaymentReference;
  target_payment: PaymentReference | null;
  chain: {
    published: boolean;
    evidence_transaction_hash: string;
    explorer_url: string;
    registry_address: string;
    block_number?: string;
  };
  canonical_evidence: Record<string, unknown>;
  canonical_evidence_jcs?: string;
  remediation: string[];
  limitations: string[];
  previous_run_id: string | null;
}

export interface PublicChainPolicy {
  id: number;
  chain_id?: number;
  network: Network;
  name: string;
  testnet: boolean;
  rpc_url: string;
  explorer_url: string;
  registry_address: `0x${string}` | null;
  registry_deployment_block: string;
  registry_runtime_code_hash: `0x${string}` | null;
  usdt0_address: `0x${string}`;
  usdt0_decimals: number;
}

export interface PublicPaymentPolicy {
  x402_enabled: boolean;
  payment_ready: boolean;
  local_unpaid_enabled: boolean;
  asset: {
    symbol: string;
    address: `0x${string}`;
    decimals: number;
  };
  pay_to: `0x${string}` | null;
  genesis_amount: string;
  genesis_amount_atomic: string;
  renewal_amount: string;
  renewal_amount_atomic: string;
}

export interface ProjectCard {
  name: string;
  build_commit: string;
  source_commit: string;
  chain: PublicChainPolicy;
  payments: PublicPaymentPolicy;
}

export interface ControlledFixture {
  variant: string;
  label: "fixture";
  launch_contract: string | null;
  health: string | null;
  source: string;
  declaration_address: string | null;
  intended_outcome: string;
}

export type PassportGateDecision = "ALLOW" | "WARN" | "BLOCK" | "REHEARSAL_REQUIRED";

export interface PassportGateSettlement {
  paymentId: string;
  network: "eip155:1952";
  asset: `0x${string}`;
  amountAtomic: string;
  assetDecimals: number;
  payer: `0x${string}`;
  recipient: `0x${string}`;
  transactionHash: `0x${string}`;
  blockTimestamp: string;
}

export interface PassportGateDecisionResult {
  operational_status: "AVAILABLE";
  decision: PassportGateDecision;
  reason_codes: string[];
  explanation: string;
  observed_at: string;
  passport_age_hours: number | null;
  warn_age_hours: number;
  max_age_hours: number;
  expires_at: string | null;
  contract_identity: {
    launchContractUrl: string;
    manifestHash: `0x${string}`;
    providerAddress: `0x${string}`;
    sourceRevision: string;
    identityHash: `0x${string}`;
  } | null;
  provider_address: `0x${string}` | null;
  source_revision: string | null;
  run_id: string | null;
  passport_url: string | null;
  status: "Verified" | "NeedsAttention" | "NotRehearsable" | null;
  gates: Record<"discoverable" | "contract_correct" | "fresh_challenge" | "safe_to_rehearse" | "paid_delivery", boolean> | null;
  independent_verification: boolean;
  database_chain_match: boolean | null;
  inbound_settlement: PassportGateSettlement | null;
  provider_settlement: PassportGateSettlement | null;
  evidence_publication_transaction: `0x${string}` | null;
  explorer_links: {
    publicationTransaction: string | null;
    inboundSettlement: string | null;
    providerSettlement: string | null;
  };
  evidence_hash: `0x${string}` | null;
  manifest_hash: `0x${string}` | null;
  input_hash: `0x${string}` | null;
  result_hash: `0x${string}` | null;
  rehearsal_action: {
    kind: "REHEARSE" | "RENEW";
    url: string;
    requiresExplicitPaymentApproval: true;
    automaticallyExecuted: false;
  } | null;
}

export interface PassportGateUnavailableResult {
  error: "verification_unavailable";
  retry_safe: true;
  operational_status: "UNAVAILABLE";
  decision: null;
  reason_codes: string[];
  explanation: string;
  observed_at: string;
}

export type PassportGateResult = PassportGateDecisionResult | PassportGateUnavailableResult;

export interface PendingRun {
  runId?: string;
  idempotencyKey: string;
  url: string;
  previousRunId?: string;
  paymentMode: PaymentMode;
  createdAt: string;
}

export const API_BASE = PUBLIC_API_BASE;
export const PENDING_RUN_STORAGE_KEY = "launchproof.pending-run.v1";
const XLAYER_TESTNET_CHAIN_ID = 1952;
const XLAYER_TESTNET_NETWORK: Network = "eip155:1952";
const XLAYER_TESTNET_USDT0 = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";
const GENESIS_AMOUNT_ATOMIC = "10000";
const RENEWAL_AMOUNT_ATOMIC = "100000";

export async function apiGet<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    } catch (cause) {
      lastError = cause;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    if (response.ok) return response.json() as Promise<T>;
    const error = new Error(await responseError(response));
    if (response.status < 500) throw error;
    lastError = error;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("The API did not respond after three attempts.");
}

export async function getProjectCard(): Promise<ProjectCard> {
  const value = await apiGet<unknown>("/.well-known/launchproof.json");
  return parseProjectCard(value);
}

export async function getControlledFixtures(): Promise<ControlledFixture[]> {
  const value = await apiGet<{ fixtures: unknown[] }>("/fixtures");
  if (!Array.isArray(value.fixtures) || !value.fixtures.every(isControlledFixture)) {
    throw new Error("The fixture catalog response is invalid.");
  }
  return value.fixtures;
}

export async function checkServicePassport(launchContractUrl: string): Promise<PassportGateResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/passport-gate/check`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launch_contract_url: launchContractUrl }),
    });
  } catch {
    throw new Error("PassportGate could not reach the verification API. No trust decision was made.");
  }
  const body = await responseJson<unknown>(response);
  if (response.status === 503 && isPassportGateUnavailable(body)) return body;
  if (!response.ok) throw new Error(await responseError(response, body));
  if (!isPassportGateDecision(body)) throw new Error("PassportGate returned an invalid decision contract. No trust decision was made.");
  return body;
}

export async function pollRun(
  runId: string,
  onUpdate: (run: RunProgress) => void,
  timeoutMs = 180_000,
): Promise<Passport> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
    const run = await responseJson<RunProgress | Passport>(response);
    onUpdate(run);
    if (response.ok && (run.state === "complete" || run.state === "complete_local")) return run as Passport;
    if (run.state === "failed") throw new Error(run.error ?? "Rehearsal failed");
    if (!response.ok && response.status !== 404) throw new Error(await responseError(response, run));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The run is still processing. This browser saved its run ID; reload this page to resume tracking it.");
}

declare global {
  interface Window {
    ethereum?: InjectedEvmProvider;
    okxwallet?: InjectedEvmProvider;
    __launchproofWalletPageActive?: boolean;
  }
}

interface InjectedEvmProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
}

const CONNECTED_WALLET_SESSION_KEY = "launchproof.connected-wallet.v1";

function getInjectedEvmProvider(): InjectedEvmProvider | undefined {
  if (typeof window === "undefined") return undefined;
  if (typeof window.okxwallet?.request === "function") return window.okxwallet;
  if (typeof window.ethereum?.request === "function") return window.ethereum;
  return undefined;
}

export async function connectWallet(projectCard: ProjectCard, requestAccountSelection = false): Promise<`0x${string}`> {
  assertTestnetPaymentAnchors(projectCard);
  const { chain } = projectCard;
  const provider = getInjectedEvmProvider();
  if (!provider) throw new Error("Install or unlock OKX Wallet (or another EVM wallet) to approve the x402 payment.");
  if (requestAccountSelection) {
    try {
      await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch (cause) {
      const code = isObject(cause) ? Number(cause.code) : Number.NaN;
      if (code === 4001) throw cause;
    }
    try {
      await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch (cause) {
      const code = isObject(cause) ? Number(cause.code) : Number.NaN;
      if (code === 4001) throw cause;
      // Some injected wallets implement eth_requestAccounts but not the
      // permissions methods. The normal request below remains the fallback.
    }
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!isAddress(account)) throw new Error("The wallet did not return a valid account.");

  const targetChainHex = `0x${chain.id.toString(16)}`;
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (Number.parseInt(chainId, 16) !== chain.id) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] });
    } catch (cause) {
      const code = isObject(cause) ? Number(cause.code) : Number.NaN;
      if (code !== 4902) throw cause;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: targetChainHex,
          chainName: chain.name,
          nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
          rpcUrls: [chain.rpc_url],
          blockExplorerUrls: [chain.explorer_url],
        }],
      });
    }
    const selectedChainId = Number.parseInt(await provider.request({ method: "eth_chainId" }) as string, 16);
    if (selectedChainId !== chain.id) throw new Error(`Wallet network mismatch: expected chain ${chain.id}.`);
  }
  return account;
}

export function rememberConnectedWallet(account: `0x${string}`): void {
  if (typeof window === "undefined") return;
  try {
    // sessionStorage intentionally survives reloads but is discarded when the
    // browser tab closes. We never persist an account permission ourselves.
    window.sessionStorage.setItem(CONNECTED_WALLET_SESSION_KEY, account);
  } catch {
    // Storage can be unavailable in locked-down browser contexts. The active
    // in-memory connection still works for the current page in that case.
  }
  window.dispatchEvent?.(new Event("launchproof:wallet"));
}

export async function forgetConnectedWallet(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CONNECTED_WALLET_SESSION_KEY);
  } catch {
    // The in-memory UI is still disconnected by the caller.
  }
  const provider = getInjectedEvmProvider();
  try {
    await provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // Revocation is not standardized across every injected EVM wallet. The
    // LaunchProof session is forgotten even when the provider lacks it.
  }
  window.dispatchEvent?.(new Event("launchproof:wallet"));
}

export async function restoreConnectedWallet(projectCard: ProjectCard): Promise<`0x${string}` | null> {
  if (typeof window === "undefined") return null;
  const activePageSession = walletPageSessionContinues();
  let priorConnection: string | null;
  try {
    priorConnection = window.sessionStorage.getItem(CONNECTED_WALLET_SESSION_KEY);
  } catch {
    return null;
  }
  if (!priorConnection || !activePageSession) return null;

  assertTestnetPaymentAnchors(projectCard);
  const provider = getInjectedEvmProvider();
  if (!provider) return null;
  try {
    // eth_accounts is silent: it only returns accounts the user has already
    // authorized, so reload never opens an unsolicited wallet prompt.
    const accounts = await provider.request({ method: "eth_accounts" });
    const account = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
    if (!account || !isAddress(account)) {
      window.sessionStorage.removeItem(CONNECTED_WALLET_SESSION_KEY);
      return null;
    }
    const chainId = await provider.request({ method: "eth_chainId" });
    if (typeof chainId !== "string" || Number.parseInt(chainId, 16) !== projectCard.chain.id) return null;
    return account;
  } catch {
    return null;
  }
}

function walletPageSessionContinues(): boolean {
  if (window.__launchproofWalletPageActive) return true;
  window.__launchproofWalletPageActive = true;
  const navigation = window.performance?.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!navigation || navigation.type === "reload") return true;
  // A fresh navigation is a newly opened app session. This also defeats
  // browsers that restore sessionStorage when reopening a closed tab.
  try {
    window.sessionStorage.removeItem(CONNECTED_WALLET_SESSION_KEY);
  } catch {
    // Ignore unavailable storage; there is nothing else to restore.
  }
  return false;
}

export function subscribeToInjectedWallet(listener: () => void): () => void {
  const provider = getInjectedEvmProvider();
  const handleChange = () => listener();
  window.addEventListener?.("launchproof:wallet", handleChange);
  provider?.on?.("accountsChanged", handleChange);
  provider?.on?.("chainChanged", handleChange);
  return () => {
    window.removeEventListener?.("launchproof:wallet", handleChange);
    provider?.removeListener?.("accountsChanged", handleChange);
    provider?.removeListener?.("chainChanged", handleChange);
  };
}

export async function submitRun(input: {
  url: string;
  previousRunId?: string;
  idempotencyKey: string;
  paymentMode: PaymentMode;
  account?: `0x${string}`;
  projectCard: ProjectCard;
}): Promise<RunProgress> {
  const route = input.previousRunId ? "/api/renewals" : "/api/rehearsals";
  const body = JSON.stringify({
    url: input.url,
    idempotency_key: input.idempotencyKey,
    ...(input.previousRunId ? { previous_run_id: input.previousRunId } : {}),
  });
  let response: Response;

  if (input.paymentMode === "local") {
    if (!input.projectCard.payments.local_unpaid_enabled) {
      throw new Error("This deployment does not permit local unpaid rehearsals.");
    }
    response = await fetch(`${API_BASE}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-launchproof-local-run": "true",
        "idempotency-key": input.idempotencyKey,
      },
      body,
    });
  } else {
    response = await submitWithPayment({ ...input, route, body });
  }

  const payload = await responseJson<RunProgress & { message?: string; detail?: string; error?: string }>(response);
  if (!response.ok) throw new Error(payload.message ?? payload.detail ?? payload.error ?? `Request failed (${response.status})`);
  if (!payload.run_id) throw new Error("The API accepted the request without returning a run ID.");
  return payload;
}

async function submitWithPayment(input: {
  route: string;
  body: string;
  previousRunId?: string;
  idempotencyKey: string;
  account?: `0x${string}`;
  projectCard: ProjectCard;
}): Promise<Response> {
  const { chain, payments } = input.projectCard;
  assertTestnetPaymentAnchors(input.projectCard);
  if (!payments.x402_enabled) throw new Error("x402 payments are not enabled in this deployment.");
  if (!payments.payment_ready) throw new Error("The published x402 payment configuration has not passed startup readiness checks.");
  if (!chain.testnet) throw new Error("Paid execution refused: this LaunchProof deployment is not configured as testnet.");
  if (!chain.registry_address) throw new Error("Paid execution refused: the public testnet registry is not configured.");
  if (!chain.registry_runtime_code_hash) throw new Error("Paid execution refused: the registry runtime code hash is not configured.");
  const provider = getInjectedEvmProvider();
  if (!provider || !input.account) throw new Error("Connect a wallet before approving payment.");
  if (!payments.pay_to) throw new Error("The public payment recipient is not configured.");

  const expectedAmount = input.previousRunId ? payments.renewal_amount_atomic : payments.genesis_amount_atomic;
  if (!/^\d+$/.test(expectedAmount)) throw new Error("The public atomic payment amount is invalid.");

  const [{ createWalletClient, custom, defineChain }, { ExactEvmScheme, toClientEvmSigner }, { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig }] =
    await Promise.all([import("viem"), import("@okxweb3/x402-evm"), import("@okxweb3/x402-fetch")]);
  const activeChain = defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [chain.rpc_url] } },
    blockExplorers: { default: { name: "Configured explorer", url: chain.explorer_url } },
    testnet: chain.testnet,
  });
  const wallet = createWalletClient({ account: input.account, chain: activeChain, transport: custom(provider) });
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

  const paidFetch = wrapFetchWithPaymentFromConfig(withoutResponseOnlyCorsHeaders(fetch), {
    schemes: [{ network: chain.network, client: new ExactEvmScheme(signer) }],
    policies: [(_version, requirements) => filterExactPaymentRequirements(requirements, {
      network: chain.network,
      asset: payments.asset.address,
      amount: expectedAmount,
      payTo: payments.pay_to!,
    })],
  });

  const response = await paidFetch(`${API_BASE}${input.route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: input.body,
  });
  if (response.status === 402) {
    const encodedResult = response.headers.get("payment-response");
    if (encodedResult) {
      try {
        const result = decodePaymentResponseHeader(encodedResult);
        const detail = result.errorMessage ?? result.errorReason;
        if (detail) throw new Error(`x402 payment was not finalized: ${detail}`);
      } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith("x402 payment was not finalized:")) throw cause;
      }
    }
  }
  return response;
}

export function withoutResponseOnlyCorsHeaders(fetchImplementation: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    // @okxweb3/x402-fetch 0.1.0 sets this response-only CORS header on its
    // signed retry. Sending it triggers an unnecessary browser preflight and
    // can be rejected by otherwise-correct APIs.
    request.headers.delete("access-control-expose-headers");
    return fetchImplementation(request);
  };
}

export function filterExactPaymentRequirements(
  requirements: PaymentRequirements[],
  expected: Pick<PaymentRequirements, "network" | "asset" | "amount" | "payTo">,
): PaymentRequirements[] {
  const accepted = requirements.filter((requirement) => {
    const legacyAmount = (requirement as unknown as { maxAmountRequired?: unknown }).maxAmountRequired;
    const amount = requirement.amount ?? (typeof legacyAmount === "string" ? legacyAmount : "");
    return requirement.scheme === "exact"
      && requirement.network === expected.network
      && equalAddress(requirement.asset, expected.asset)
      && amount === expected.amount
      && equalAddress(requirement.payTo, expected.payTo);
  });
  if (accepted.length === 0) {
    throw new Error("Payment refused: the x402 challenge did not exactly match the published network, asset, amount, recipient, and scheme.");
  }
  return accepted;
}

export function savePendingRun(value: PendingRun): void {
  window.localStorage.setItem(PENDING_RUN_STORAGE_KEY, JSON.stringify(value));
}

export function loadPendingRun(): PendingRun | null {
  try {
    const raw = window.localStorage.getItem(PENDING_RUN_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingRun>;
    if (typeof value.idempotencyKey !== "string" || typeof value.url !== "string") return null;
    if (value.paymentMode !== "paid" && value.paymentMode !== "local") return null;
    return {
      idempotencyKey: value.idempotencyKey,
      url: value.url,
      paymentMode: value.paymentMode,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
      ...(typeof value.previousRunId === "string" ? { previousRunId: value.previousRunId } : {}),
    };
  } catch {
    return null;
  }
}

export function clearPendingRun(): void {
  window.localStorage.removeItem(PENDING_RUN_STORAGE_KEY);
}

export function paymentDisplayAmount(payment: PaymentReference): string {
  return typeof payment.amount_display === "string" && payment.amount_display.length > 0
    ? payment.amount_display
    : payment.amount_atomic
      ? `${payment.amount_atomic} atomic units`
      : `${payment.amount} (legacy units not declared)`;
}

export function testnetPaymentAnchorError(projectCard: ProjectCard): string | null {
  try {
    assertTestnetPaymentAnchors(projectCard);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The public testnet payment anchors are invalid.";
  }
}

export function assertTestnetPaymentAnchors(projectCard: ProjectCard): void {
  const { chain, payments } = projectCard;
  if (!chain.testnet || chain.id !== XLAYER_TESTNET_CHAIN_ID || chain.network !== XLAYER_TESTNET_NETWORK) {
    throw new Error("Paid signing is locked to X Layer testnet (eip155:1952).");
  }
  if (chain.usdt0_address.toLowerCase() !== XLAYER_TESTNET_USDT0
    || payments.asset.address.toLowerCase() !== XLAYER_TESTNET_USDT0
    || chain.usdt0_decimals !== 6
    || payments.asset.decimals !== 6) {
    throw new Error("Paid signing is locked to the official 6-decimal X Layer test USD₮0 contract.");
  }
  if (payments.genesis_amount_atomic !== GENESIS_AMOUNT_ATOMIC || payments.renewal_amount_atomic !== RENEWAL_AMOUNT_ATOMIC) {
    throw new Error("Paid signing refused: the atomic rehearsal prices differ from the fixed product policy.");
  }

  const anchoredPayout = process.env.NEXT_PUBLIC_PAYOUT_ADDRESS;
  if (!anchoredPayout || !isAddress(anchoredPayout)) {
    throw new Error("Paid signing requires a valid NEXT_PUBLIC_PAYOUT_ADDRESS build anchor.");
  }
  if (!payments.pay_to || !equalAddress(payments.pay_to, anchoredPayout)) {
    throw new Error("Paid signing refused: the project-card recipient does not match the frontend payout anchor.");
  }

  const anchoredChainId = process.env.NEXT_PUBLIC_CHAIN_ID;
  if (anchoredChainId && Number(anchoredChainId) !== chain.id) {
    throw new Error("Paid signing refused: the project-card chain does not match the frontend chain anchor.");
  }
  const anchoredRpc = process.env.NEXT_PUBLIC_XLAYER_RPC_URL;
  if (anchoredRpc && normalizedUrl(anchoredRpc) !== normalizedUrl(chain.rpc_url)) {
    throw new Error("Paid signing refused: the project-card RPC does not match the frontend RPC anchor.");
  }
  const anchoredRegistry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
  if (anchoredRegistry && (!chain.registry_address || !equalAddress(chain.registry_address, anchoredRegistry))) {
    throw new Error("Paid signing refused: the project-card registry does not match the frontend registry anchor.");
  }
  const anchoredDeploymentBlock = process.env.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK;
  if (anchoredDeploymentBlock
    && (!/^\d+$/.test(anchoredDeploymentBlock) || BigInt(anchoredDeploymentBlock) !== BigInt(chain.registry_deployment_block))) {
    throw new Error("Paid signing refused: the registry deployment block does not match the frontend anchor.");
  }
}

function parseProjectCard(value: unknown): ProjectCard {
  if (!isObject(value) || !isObject(value.chain) || !isObject(value.payments)) {
    throw new Error("The API project card does not contain the required chain and payment policy.");
  }
  const { chain, payments } = value;
  const asset = payments.asset;
  if (!isObject(asset)) throw new Error("The API project card does not contain a payment asset policy.");
  const chainId = Number(chain.id ?? chain.chain_id);
  const network = String(chain.network ?? "");
  const registry = chain.registry_address;
  const runtimeCodeHash = chain.registry_runtime_code_hash;
  const chainAssetAddress = chain.usdt0_address;
  const assetAddress = asset.address;
  const payTo = payments.pay_to;
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !isNetwork(network) || network !== `eip155:${chainId}`) throw new Error("The project card has an invalid chain identity.");
  if (!isHttpUrl(chain.rpc_url) || !isHttpUrl(chain.explorer_url)) throw new Error("The project card has invalid public chain URLs.");
  if (!/^\d+$/.test(String(chain.registry_deployment_block))) throw new Error("The project card has an invalid registry deployment block.");
  if (registry !== null && !isAddress(registry)) throw new Error("The project card has an invalid registry address.");
  if (runtimeCodeHash !== null && !isBytes32(runtimeCodeHash)) throw new Error("The project card has an invalid registry runtime code hash.");
  if (!isAddress(assetAddress) || (payTo !== null && !isAddress(payTo))) throw new Error("The project card has an invalid payment address.");
  if (!Number.isInteger(Number(asset.decimals)) || Number(asset.decimals) < 0 || Number(asset.decimals) > 255) {
    throw new Error("The project card has invalid asset decimals.");
  }
  if (!isAddress(chainAssetAddress)
    || chainAssetAddress.toLowerCase() !== assetAddress.toLowerCase()
    || Number(chain.usdt0_decimals) !== Number(asset.decimals)) {
    throw new Error("The project card chain and payment asset policies do not match.");
  }
  if (!/^\d+$/.test(String(payments.genesis_amount_atomic)) || !/^\d+$/.test(String(payments.renewal_amount_atomic))) {
    throw new Error("The project card has an invalid atomic price.");
  }
  return {
    name: String(value.name ?? "LaunchProof"),
    build_commit: String(value.build_commit ?? "unknown"),
    source_commit: String(value.source_commit ?? "unknown"),
    chain: {
      id: chainId,
      network,
      name: String(chain.name ?? `Chain ${chainId}`),
      testnet: chain.testnet === true,
      rpc_url: String(chain.rpc_url),
      explorer_url: String(chain.explorer_url).replace(/\/$/, ""),
      registry_address: registry as `0x${string}` | null,
      registry_deployment_block: String(chain.registry_deployment_block ?? "0"),
      registry_runtime_code_hash: runtimeCodeHash as `0x${string}` | null,
      usdt0_address: chainAssetAddress,
      usdt0_decimals: Number(chain.usdt0_decimals),
    },
    payments: {
      x402_enabled: payments.x402_enabled === true,
      payment_ready: payments.payment_ready === true,
      local_unpaid_enabled: payments.local_unpaid_enabled === true,
      asset: {
        symbol: String(asset.symbol ?? "token"),
        address: assetAddress,
        decimals: Number(asset.decimals),
      },
      pay_to: payTo as `0x${string}` | null,
      genesis_amount: String(payments.genesis_amount ?? ""),
      genesis_amount_atomic: String(payments.genesis_amount_atomic),
      renewal_amount: String(payments.renewal_amount ?? ""),
      renewal_amount_atomic: String(payments.renewal_amount_atomic),
    },
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  try {
    return await response.clone().json() as T;
  } catch {
    return { state: response.ok ? "unknown" : "failed", error: `Request failed (${response.status})` } as T;
  }
}

async function responseError(response: Response, parsed?: unknown): Promise<string> {
  if (isObject(parsed)) {
    const message = parsed.message ?? parsed.detail ?? parsed.error;
    if (typeof message === "string") return message;
  }
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    const message = body.message ?? body.detail ?? body.error;
    if (typeof message === "string") return message;
  } catch {
    // The status remains the safest error when a response is not JSON.
  }
  return `Request failed (${response.status})`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPassportGateUnavailable(value: unknown): value is PassportGateUnavailableResult {
  return isObject(value)
    && value.error === "verification_unavailable"
    && value.retry_safe === true
    && value.operational_status === "UNAVAILABLE"
    && value.decision === null
    && Array.isArray(value.reason_codes)
    && value.reason_codes.every((reason) => typeof reason === "string")
    && typeof value.explanation === "string"
    && typeof value.observed_at === "string";
}

function isPassportGateDecision(value: unknown): value is PassportGateDecisionResult {
  if (!isObject(value) || value.operational_status !== "AVAILABLE") return false;
  if (!["ALLOW", "WARN", "BLOCK", "REHEARSAL_REQUIRED"].includes(String(value.decision))) return false;
  if (!Array.isArray(value.reason_codes) || !value.reason_codes.every((reason) => typeof reason === "string")) return false;
  if (typeof value.explanation !== "string" || typeof value.observed_at !== "string") return false;
  if (!isNullableFiniteNumber(value.passport_age_hours)
    || typeof value.warn_age_hours !== "number"
    || typeof value.max_age_hours !== "number"
    || (value.expires_at !== null && typeof value.expires_at !== "string")) return false;
  if (value.contract_identity !== null && (!isObject(value.contract_identity)
    || typeof value.contract_identity.launchContractUrl !== "string"
    || !isBytes32(value.contract_identity.manifestHash)
    || !isAddress(value.contract_identity.providerAddress)
    || !isSourceRevision(value.contract_identity.sourceRevision)
    || !isBytes32(value.contract_identity.identityHash))) return false;
  if (value.provider_address !== null && !isAddress(value.provider_address)) return false;
  if (value.source_revision !== null && !isSourceRevision(value.source_revision)) return false;
  if (value.run_id !== null && typeof value.run_id !== "string") return false;
  if (value.passport_url !== null && !isHttpUrl(value.passport_url)) return false;
  if (!["Verified", "NeedsAttention", "NotRehearsable", null].includes(value.status as string | null)) return false;
  const gates = value.gates;
  if (gates !== null && (!isObject(gates)
    || !["discoverable", "contract_correct", "fresh_challenge", "safe_to_rehearse", "paid_delivery"]
      .every((gate) => typeof gates[gate] === "boolean"))) return false;
  const explorerLinks = value.explorer_links;
  if (typeof value.independent_verification !== "boolean" || !isObject(explorerLinks)) return false;
  if (!["publicationTransaction", "inboundSettlement", "providerSettlement"]
    .every((link) => explorerLinks[link] === null || typeof explorerLinks[link] === "string")) return false;
  if (value.inbound_settlement !== null && !isPassportGateSettlement(value.inbound_settlement)) return false;
  if (value.provider_settlement !== null && !isPassportGateSettlement(value.provider_settlement)) return false;
  if (value.database_chain_match !== null && typeof value.database_chain_match !== "boolean") return false;
  if (value.evidence_publication_transaction !== null && !isBytes32(value.evidence_publication_transaction)) return false;
  if (![value.evidence_hash, value.manifest_hash, value.input_hash, value.result_hash]
    .every((hash) => hash === null || isBytes32(hash))) return false;
  if (value.rehearsal_action !== null && (!isObject(value.rehearsal_action)
    || !["REHEARSE", "RENEW"].includes(String(value.rehearsal_action.kind))
    || !isHttpUrl(value.rehearsal_action.url)
    || value.rehearsal_action.requiresExplicitPaymentApproval !== true
    || value.rehearsal_action.automaticallyExecuted !== false)) return false;
  return true;
}

function isPassportGateSettlement(value: unknown): value is PassportGateSettlement {
  return isObject(value)
    && typeof value.paymentId === "string"
    && value.network === XLAYER_TESTNET_NETWORK
    && isAddress(value.asset)
    && typeof value.amountAtomic === "string"
    && /^\d+$/.test(value.amountAtomic)
    && Number.isInteger(value.assetDecimals)
    && isAddress(value.payer)
    && isAddress(value.recipient)
    && isBytes32(value.transactionHash)
    && typeof value.blockTimestamp === "string";
}

function isControlledFixture(value: unknown): value is ControlledFixture {
  return isObject(value)
    && typeof value.variant === "string"
    && value.label === "fixture"
    && (value.launch_contract === null || isHttpUrl(value.launch_contract))
    && (value.health === null || isHttpUrl(value.health))
    && isHttpUrl(value.source)
    && (value.declaration_address === null || isAddress(value.declaration_address))
    && typeof value.intended_outcome === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isSourceRevision(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{40}$/.test(value);
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(value)
    && !/^0x0{40}$/i.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function equalAddress(left: string, right: string): boolean {
  return isAddress(left) && isAddress(right) && left.toLowerCase() === right.toLowerCase();
}

function isNetwork(value: string): value is Network {
  return /^[a-zA-Z0-9-]+:[a-zA-Z0-9-]+$/.test(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
