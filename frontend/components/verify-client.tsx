"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, keccak256 } from "viem";
import { apiGet, getProjectCard, type Passport, type ProjectCard } from "../lib/generated-api/client";
import { registryReadAbi } from "../lib/registry-abi";

export function VerifyClient({ runId }: { runId: string }) {
  const [apiVerification, setApiVerification] = useState<Record<string, unknown> | null>(null);
  const [browserVerification, setBrowserVerification] = useState<Record<string, unknown> | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void apiGet<Record<string, unknown>>(`/verify/${encodeURIComponent(runId)}`)
      .then((result) => { if (!cancelled) setApiVerification(result); })
      .catch((cause) => { if (!cancelled) setApiError(errorMessage(cause, "API verification failed")); });

    void (async () => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(runId)) throw new Error("A registry run ID must be a 32-byte hex value.");
      const [projectCard, passport] = await Promise.all([
        getProjectCard(),
        apiGet<Passport>(`/runs/${encodeURIComponent(runId)}`),
      ]);
      const config = browserChainConfig(projectCard);
      const client = createPublicClient({ transport: http(config.rpcUrl) });
      const rpcChainId = await client.getChainId();
      if (rpcChainId !== projectCard.chain.id) {
        throw new Error(`RPC chain mismatch: expected ${projectCard.chain.id}, received ${rpcChainId}.`);
      }
      const [record, contractCode] = await Promise.all([
        client.readContract({
          address: config.registry,
          abi: registryReadAbi,
          functionName: "getRun",
          args: [runId as `0x${string}`],
        }),
        client.getCode({ address: config.registry }),
      ]);
      const payloadHash = passport.canonical_evidence_jcs
        ? await sha256(passport.canonical_evidence_jcs)
        : null;
      const runtimeCodeHash = contractCode && contractCode !== "0x" ? keccak256(contractCode) : null;
      if (!cancelled) {
        setBrowserVerification({
          source: "Direct read-only browser RPC using the bundled registry interface",
          configuration_source: config.source,
          expected_chain_id: projectCard.chain.id,
          rpc_chain_id: rpcChainId,
          chain_id_match: rpcChainId === projectCard.chain.id,
          registry: config.registry,
          registry_deployment_block: config.deploymentBlock,
          registry_matches_project_card: config.registry.toLowerCase() === projectCard.chain.registry_address?.toLowerCase(),
          contract_code_present: Boolean(contractCode && contractCode !== "0x"),
          runtime_code_hash: runtimeCodeHash,
          runtime_code_hash_match: runtimeCodeHash && projectCard.chain.registry_runtime_code_hash
            ? equalHex(runtimeCodeHash, projectCard.chain.registry_runtime_code_hash)
            : false,
          record_found: Number(record.anchoredAt) > 0,
          evidence_hash_match: equalHex(record.evidenceHash, passport.evidence_hash),
          manifest_hash_match: equalHex(record.manifestHash, passport.manifest_hash),
          input_hash_match: equalHex(record.inputHash, passport.input_hash),
          result_hash_match: equalHex(record.normalizedResultHash, passport.normalized_result_hash),
          canonical_payload_hash_match: payloadHash ? equalHex(payloadHash, record.evidenceHash) : "canonical JCS payload not returned by API",
          provider: record.provider,
          anchored_by: record.anchoredBy,
          anchored_at_unix: Number(record.anchoredAt),
          gate_bitmap: Number(record.gateBitmap),
          contract_status: Number(record.status),
          provider_signature_verified: record.providerSignatureVerified,
          fixture_flag: record.isFixture,
        });
      }
    })().catch((cause) => { if (!cancelled) setBrowserError(errorMessage(cause, "Browser RPC verification failed")); });

    return () => { cancelled = true; };
  }, [runId]);

  return (
    <main className="page">
      <section className="page-title">
        <p className="eyebrow">Complementary verification paths</p>
        <h1>Verify against the configured X Layer registry</h1>
        <p>The browser reads contract storage through the configured public RPC and compares it with the public Passport response. The API separately reconstructs event evidence and reports cache agreement; because both paths use API-provided evidence, they are complementary rather than fully independent.</p>
      </section>
      <div className="two-column">
        <section className="panel">
          <p className="eyebrow">Storage cross-check</p>
          <h2>Direct browser RPC</h2>
          {browserError ? <p className="error">{browserError}</p> : browserVerification ? <VerificationRows data={browserVerification} /> : <div className="loading compact">Reading configured X Layer RPC…</div>}
        </section>
        <section className="panel">
          <p className="eyebrow">Evidence reconstruction</p>
          <h2>API log verification</h2>
          {apiError ? <p className="error">{apiError}</p> : apiVerification ? <VerificationRows data={apiVerification} /> : <div className="loading compact">Reconstructing registry evidence…</div>}
        </section>
      </div>
    </main>
  );
}

function VerificationRows({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="verification-list">
      {Object.entries(data).filter(([key]) => key !== "canonical_evidence").map(([key, value]) => (
        <div key={key}>
          <dt>{key.replaceAll("_", " ")}</dt>
          <dd className={value === true ? "value-pass" : value === false ? "value-fail" : ""}>{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function browserChainConfig(projectCard: ProjectCard): { rpcUrl: string; registry: `0x${string}`; deploymentBlock: string; source: string } {
  const envChainId = process.env.NEXT_PUBLIC_CHAIN_ID;
  const envRpc = process.env.NEXT_PUBLIC_XLAYER_RPC_URL;
  const envRegistry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
  const envDeploymentBlock = process.env.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK;
  if (envChainId && Number(envChainId) !== projectCard.chain.id) {
    throw new Error(`Frontend chain configuration (${envChainId}) does not match the project card (${projectCard.chain.id}).`);
  }
  if (envRegistry && envRegistry.toLowerCase() !== projectCard.chain.registry_address?.toLowerCase()) {
    throw new Error("Frontend registry configuration does not match the public project card.");
  }
  if (envDeploymentBlock) {
    if (!/^\d+$/.test(envDeploymentBlock)) throw new Error("Frontend registry deployment block is invalid.");
    if (BigInt(envDeploymentBlock) !== BigInt(projectCard.chain.registry_deployment_block)) {
      throw new Error("Frontend registry deployment block does not match the public project card.");
    }
  }
  const registry = envRegistry ?? projectCard.chain.registry_address;
  if (!registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) throw new Error("No valid public registry address is configured.");
  return {
    rpcUrl: envRpc ?? projectCard.chain.rpc_url,
    registry: registry as `0x${string}`,
    deploymentBlock: envDeploymentBlock ?? projectCard.chain.registry_deployment_block,
    source: envRpc || envRegistry || envChainId || envDeploymentBlock ? "frontend build configuration, checked against project card" : "public project card",
  };
}

async function sha256(value: string): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function equalHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function renderValue(value: unknown): string {
  if (value === true) return "✓ match";
  if (value === false) return "× no";
  if (value === null || value === undefined) return "not available";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}
