import { createPublicClient, fallback, http, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import type { Config } from "../config.js";
import { CHAIN_ID, MAX_EVIDENCE_BYTES, USDT0_ADDRESS } from "../config.js";

const identityAbi = [
  { type: "function", name: "writer", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "MAX_EVIDENCE_BYTES", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;
const assetAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

export async function validateProductionChain(config: Config): Promise<void> {
  if (!config.productionReady) return;
  const transport = fallback([http(config.XLAYER_RPC_URL), http(config.XLAYER_FALLBACK_RPC_URL)]);
  const client = createPublicClient({ chain: xLayer, transport });
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`Production RPC returned chain ${chainId}; expected ${CHAIN_ID}`);
  const registry = config.REGISTRY_ADDRESS as `0x${string}`;
  const [registryCode, assetCode, assetDecimals, writer, maxEvidence] = await Promise.all([
    client.getCode({ address: registry }),
    client.getCode({ address: USDT0_ADDRESS }),
    client.readContract({ address: USDT0_ADDRESS, abi: assetAbi, functionName: "decimals" }),
    client.readContract({ address: registry, abi: identityAbi, functionName: "writer" }),
    client.readContract({ address: registry, abi: identityAbi, functionName: "MAX_EVIDENCE_BYTES" }),
  ]);
  if (!registryCode || registryCode === "0x") throw new Error("REGISTRY_ADDRESS has no bytecode on X Layer mainnet");
  if (!assetCode || assetCode === "0x") throw new Error("Configured USDT0 asset has no bytecode on X Layer mainnet");
  if (assetDecimals !== 6) throw new Error("Configured USDT0 asset does not expose the expected 6 decimals");
  if (maxEvidence !== BigInt(MAX_EVIDENCE_BYTES)) throw new Error("Registry bytecode does not expose the required evidence limit");
  const writerAccount = privateKeyToAccount(config.REGISTRY_WRITER_PRIVATE_KEY as `0x${string}`);
  if (writer.toLowerCase() !== writerAccount.address.toLowerCase()) throw new Error("Registry writer key does not match the deployed immutable writer");
  if (writer === zeroAddress || writer.toLowerCase() === config.PAYOUT_ADDRESS!.toLowerCase()) throw new Error("Registry writer and payout wallet must be separate nonzero addresses");
  const targetPayer = privateKeyToAccount(config.TARGET_PAYER_PRIVATE_KEY as `0x${string}`).address;
  if ([writer, config.PAYOUT_ADDRESS!].some((address) => address.toLowerCase() === targetPayer.toLowerCase())) {
    throw new Error("Target payer wallet must be separate from registry writer and payout wallets");
  }
}
