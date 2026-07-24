import { createPublicClient, fallback, http, keccak256, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import type { Config } from "../config.js";
import { MAX_EVIDENCE_BYTES } from "../config.js";

const identityAbi = [
  { type: "function", name: "writer", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "MAX_EVIDENCE_BYTES", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;
const assetAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

export async function validateProductionChain(config: Config): Promise<void> {
  if (
    !config.chainReady ||
    !config.XLAYER_RPC_URL ||
    !config.REGISTRY_ADDRESS ||
    !config.REGISTRY_WRITER_PRIVATE_KEY ||
    !config.REGISTRY_RUNTIME_CODE_HASH
  ) return;
  const transports = [http(config.XLAYER_RPC_URL), ...(config.XLAYER_FALLBACK_RPC_URL ? [http(config.XLAYER_FALLBACK_RPC_URL)] : [])];
  const transport = transports.length > 1 ? fallback(transports) : transports[0]!;
  if (!config.chain.testnet || config.chain.id !== 1952 || config.chain.network !== "eip155:1952") {
    throw new Error("Production chain preflight is restricted to X Layer testnet (eip155:1952)");
  }
  const client = createPublicClient({ chain: xLayerTestnet, transport });
  const chainId = await client.getChainId();
  if (chainId !== config.chain.id) throw new Error(`X Layer RPC returned chain ${chainId}; expected ${config.chain.id}`);
  const registry = config.REGISTRY_ADDRESS as `0x${string}`;
  const [registryCode, deploymentCode, beforeDeploymentCode, currentBlock, writer, maxEvidence] = await Promise.all([
    client.getCode({ address: registry }),
    client.getCode({ address: registry, blockNumber: config.REGISTRY_DEPLOYMENT_BLOCK }),
    client.getCode({ address: registry, blockNumber: config.REGISTRY_DEPLOYMENT_BLOCK - 1n }),
    client.getBlockNumber(),
    client.readContract({ address: registry, abi: identityAbi, functionName: "writer" }),
    client.readContract({ address: registry, abi: identityAbi, functionName: "MAX_EVIDENCE_BYTES" }),
  ]);
  if (config.REGISTRY_DEPLOYMENT_BLOCK > currentBlock) throw new Error("REGISTRY_DEPLOYMENT_BLOCK is ahead of the current X Layer block");
  if (!registryCode || registryCode === "0x") throw new Error(`REGISTRY_ADDRESS has no bytecode on ${config.chain.name}`);
  if (!deploymentCode || deploymentCode === "0x") throw new Error("Registry was not deployed at REGISTRY_DEPLOYMENT_BLOCK");
  if (beforeDeploymentCode && beforeDeploymentCode !== "0x") throw new Error("REGISTRY_DEPLOYMENT_BLOCK is not the contract creation block");
  if (keccak256(registryCode).toLowerCase() !== config.REGISTRY_RUNTIME_CODE_HASH.toLowerCase()) {
    throw new Error("Registry runtime bytecode does not match REGISTRY_RUNTIME_CODE_HASH");
  }
  if (maxEvidence !== BigInt(MAX_EVIDENCE_BYTES)) throw new Error("Registry bytecode does not expose the required evidence limit");
  const writerAccount = privateKeyToAccount(config.REGISTRY_WRITER_PRIVATE_KEY as `0x${string}`);
  if (writer.toLowerCase() !== writerAccount.address.toLowerCase()) throw new Error("Registry writer key does not match the deployed immutable writer");
  if (writer === zeroAddress) throw new Error("Registry writer must be nonzero");
  if (await client.getBalance({ address: writerAccount.address }) === 0n) throw new Error("Registry writer has no gas balance");
  if (config.PAYOUT_ADDRESS && writer.toLowerCase() === config.PAYOUT_ADDRESS.toLowerCase()) {
    throw new Error("Registry writer and payout wallet must be separate addresses");
  }
  if (config.TARGET_PAYER_PRIVATE_KEY) {
    const targetPayer = privateKeyToAccount(config.TARGET_PAYER_PRIVATE_KEY as `0x${string}`).address;
    if ([writer, config.PAYOUT_ADDRESS].filter(Boolean).some((address) => address!.toLowerCase() === targetPayer.toLowerCase())) {
      throw new Error("Target payer wallet must be separate from registry writer and payout wallets");
    }
    if (await client.getBalance({ address: targetPayer }) === 0n) throw new Error("Target payer has no gas balance");
  }
  if (config.X402_ENABLED) {
    const asset = config.chain.usdt0Address;
    const [assetCode, assetDecimals] = await Promise.all([
      client.getCode({ address: asset }),
      client.readContract({ address: asset, abi: assetAbi, functionName: "decimals" }),
    ]);
    if (!assetCode || assetCode === "0x") throw new Error(`Configured USDT0 asset has no bytecode on ${config.chain.name}`);
    if (assetDecimals !== config.chain.usdt0Decimals) throw new Error("Configured USDT0 asset does not expose the expected 6 decimals");
    if (config.TARGET_PAYER_PRIVATE_KEY) {
      const targetPayer = privateKeyToAccount(config.TARGET_PAYER_PRIVATE_KEY as `0x${string}`).address;
      const tokenBalance = await client.readContract({
        address: asset,
        abi: assetAbi,
        functionName: "balanceOf",
        args: [targetPayer],
      });
      const requiredBalance = BigInt(Math.ceil(config.TARGET_PAYMENT_MAX_USDT0 * 1_000_000));
      if (tokenBalance < requiredBalance) {
        throw new Error("Target payer USD₮0 balance is below TARGET_PAYMENT_MAX_USDT0");
      }
    }
  }
  if (config.paymentReady) {
    const facilitator = new OKXFacilitatorClient({
      apiKey: config.OKX_API_KEY!,
      secretKey: config.OKX_SECRET_KEY!,
      passphrase: config.OKX_PASSPHRASE!,
      ...(config.OKX_BASE_URL ? { baseUrl: config.OKX_BASE_URL } : {}),
      syncSettle: true,
    });
    const supported = await facilitator.getSupported();
    if (!supported.kinds.some((kind) => kind.scheme === "exact" && kind.network === config.chain.network)) {
      throw new Error(`OKX facilitator does not advertise exact settlement for ${config.chain.network}`);
    }
  }
}
