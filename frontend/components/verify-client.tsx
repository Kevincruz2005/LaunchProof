"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { xLayer } from "viem/chains";
import { API_BASE, apiGet, type Passport } from "../lib/generated-api/client";

export function VerifyClient({ runId }: { runId: string }) {
  const [apiVerification, setApiVerification] = useState<Record<string, unknown> | null>(null);
  const [browserVerification, setBrowserVerification] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const api = await apiGet<Record<string, unknown>>(`/verify/${encodeURIComponent(runId)}`);
      setApiVerification(api);
      const rpc = process.env.NEXT_PUBLIC_XLAYER_RPC_URL;
      const registry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS;
      if (!rpc || !registry || !/^0x[0-9a-fA-F]{64}$/.test(runId)) {
        setBrowserVerification({ configured: false, detail: "Browser RPC verification requires public X Layer RPC and registry configuration." });
        return;
      }
      const [abi, passport] = await Promise.all([
        fetch(`${API_BASE}/schema/registry.abi.json`, { cache: "no-store" }).then((response) => response.json()),
        apiGet<Passport>(`/runs/${encodeURIComponent(runId)}`),
      ]);
      const client = createPublicClient({ chain: xLayer, transport: http(rpc) });
      const chainId = await client.getChainId();
      const record = await client.readContract({
        address: registry as `0x${string}`,
        abi,
        functionName: "getRun",
        args: [runId as `0x${string}`],
      }) as {
        evidenceHash: string; manifestHash: string; inputHash: string; normalizedResultHash: string;
        anchoredBy: string; anchoredAt: number; gateBitmap: number; status: number;
      };
      setBrowserVerification({
        configured: true,
        source: "Direct read-only browser RPC",
        chain_id: chainId,
        registry,
        record_found: Number(record.anchoredAt) > 0,
        evidence_hash_match: record.evidenceHash === passport.evidence_hash,
        manifest_hash_match: record.manifestHash === passport.manifest_hash,
        input_hash_match: record.inputHash === passport.input_hash,
        result_hash_match: record.normalizedResultHash === passport.normalized_result_hash,
        anchored_by: record.anchoredBy,
        gate_bitmap: Number(record.gateBitmap),
        contract_status: Number(record.status),
      });
    })().catch((cause) => setError(cause instanceof Error ? cause.message : "Verification failed"));
  }, [runId]);
  return (
    <main className="page">
      <section className="page-title"><p className="eyebrow">Two independent views</p><h1>Verify against X Layer</h1><p>The browser reads contract storage directly. The backend separately reconstructs event evidence and reports cache agreement.</p></section>
      {error ? <p className="error">{error}</p> : null}
      <div className="two-column">
        <section className="panel"><p className="eyebrow">Chain view</p><h2>Direct browser RPC</h2>{browserVerification ? <VerificationRows data={browserVerification} /> : <div className="loading compact">Reading X Layer…</div>}</section>
        <section className="panel"><p className="eyebrow">Evidence view</p><h2>Log reconstruction + cache</h2>{apiVerification ? <VerificationRows data={apiVerification} /> : <div className="loading compact">Recomputing evidence…</div>}</section>
      </div>
    </main>
  );
}

function VerificationRows({ data }: { data: Record<string, unknown> }) {
  return <dl className="verification-list">{Object.entries(data).filter(([key]) => key !== "canonical_evidence").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd className={value === true ? "value-pass" : value === false ? "value-fail" : ""}>{value === true ? "✓ match" : value === false ? "× no" : String(value ?? "not available")}</dd></div>)}</dl>;
}
