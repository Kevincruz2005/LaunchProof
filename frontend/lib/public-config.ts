export const PUBLIC_API_BASE = configuredPublicBase("NEXT_PUBLIC_API_BASE_URL", process.env.NEXT_PUBLIC_API_BASE_URL, 4000);
export const PUBLIC_WEB_BASE = configuredPublicBase("NEXT_PUBLIC_WEB_BASE_URL", process.env.NEXT_PUBLIC_WEB_BASE_URL, 3000);
export const PUBLIC_CHAIN_ANCHORS = configuredChainAnchors();
export const PUBLIC_SOURCE_REPOSITORY = configuredSourceRepository();

function configuredPublicBase(name: string, configured: string | undefined, testPort: number): string {
  if (!configured) {
    if (process.env.NODE_ENV === "test") return `http://localhost:${testPort}`;
    throw new Error(`${name} must be configured for the LaunchProof frontend.`);
  }
  let value: URL;
  try {
    value = new URL(configured);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  const loopback = value.hostname === "localhost" || value.hostname === "127.0.0.1" || value.hostname === "[::1]";
  if (value.protocol !== "https:" && !(value.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS outside local development.`);
  }
  if (value.username || value.password || value.search || value.hash || (value.pathname !== "/" && value.pathname !== "")) {
    throw new Error(`${name} must be an origin without credentials, a path, query, or fragment.`);
  }
  const hostname = value.hostname.replace(/\.$/, "").toLowerCase();
  if (process.env.NODE_ENV === "production" && (
    loopback || hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    hostname.endsWith(".example") || hostname.endsWith(".invalid") || hostname.endsWith(".test")
  )) throw new Error(`${name} must be a public, non-placeholder origin.`);
  return value.toString().replace(/\/$/, "");
}

function configuredChainAnchors(): {
  chainId: 1952;
  rpcUrl: string;
  registryAddress: `0x${string}`;
  payoutAddress: `0x${string}`;
  registryDeploymentBlock: string;
} {
  if (process.env.NODE_ENV === "test") {
    return {
      chainId: 1952,
      rpcUrl: process.env.NEXT_PUBLIC_XLAYER_RPC_URL || "https://rpc.tests.invalid",
      registryAddress: (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || `0x${"1".repeat(40)}`) as `0x${string}`,
      payoutAddress: (process.env.NEXT_PUBLIC_PAYOUT_ADDRESS || `0x${"2".repeat(40)}`) as `0x${string}`,
      registryDeploymentBlock: process.env.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK || "1",
    };
  }
  const chainId = required("NEXT_PUBLIC_CHAIN_ID");
  if (chainId !== "1952") throw new Error("NEXT_PUBLIC_CHAIN_ID must be X Layer testnet chain 1952.");
  const rpcUrl = configuredPublicUrl("NEXT_PUBLIC_XLAYER_RPC_URL", required("NEXT_PUBLIC_XLAYER_RPC_URL"));
  const registryAddress = configuredAddress("NEXT_PUBLIC_REGISTRY_ADDRESS", required("NEXT_PUBLIC_REGISTRY_ADDRESS"));
  const payoutAddress = configuredAddress("NEXT_PUBLIC_PAYOUT_ADDRESS", required("NEXT_PUBLIC_PAYOUT_ADDRESS"));
  const registryDeploymentBlock = required("NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK");
  if (!/^[1-9][0-9]*$/.test(registryDeploymentBlock)) throw new Error("NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK must be a positive block number.");
  if (registryAddress.toLowerCase() === payoutAddress.toLowerCase()) throw new Error("Frontend registry and payout anchors must be distinct.");
  return { chainId: 1952, rpcUrl, registryAddress, payoutAddress, registryDeploymentBlock };
}

function configuredSourceRepository(): string {
  const value = process.env.NEXT_PUBLIC_SOURCE_REPOSITORY;
  if (!value && process.env.NODE_ENV === "test") return "https://github.com/tests/launchproof";
  if (!value || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i.test(value)) {
    throw new Error("NEXT_PUBLIC_SOURCE_REPOSITORY must be an explicit public GitHub repository.");
  }
  return value.replace(/\/$/, "");
}

function configuredPublicUrl(name: string, configured: string): string {
  let value: URL;
  try {
    value = new URL(configured);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
  const hostname = value.hostname.replace(/\.$/, "").toLowerCase();
  if (
    value.protocol !== "https:" || value.username || value.password || value.search || value.hash ||
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
    hostname.endsWith(".internal") || hostname.endsWith(".example") || hostname.endsWith(".invalid") || hostname.endsWith(".test")
  ) throw new Error(`${name} must be a public, non-placeholder HTTPS URL.`);
  return value.toString();
}

function configuredAddress(name: string, value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error(`${name} must be a nonzero EVM address.`);
  return value as `0x${string}`;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured for the LaunchProof frontend.`);
  return value;
}
