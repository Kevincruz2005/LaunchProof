"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, apiGet, getProjectCard, paymentDisplayAmount, type Passport, type ProjectCard } from "../lib/generated-api/client";
import { CopyValue } from "./copy-value";
import { GateGrid, StatusBadge } from "./gates";
import { Disclaimers } from "./brand";

export function PassportView({ passport }: { passport: Passport }) {
  const [chainVerified, setChainVerified] = useState<boolean | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [projectCard, setProjectCard] = useState<ProjectCard | null>(null);
  useEffect(() => {
    void getProjectCard().then(setProjectCard).catch(() => setProjectCard(null));
    if (!passport.chain.published) {
      setChainVerified(false);
      return;
    }
    void apiGet<{ match: boolean }>(`/verify/${encodeURIComponent(passport.run_id)}`)
      .then((verification) => setChainVerified(verification.match === true))
      .catch((cause) => {
        setChainVerified(false);
        setVerificationError(cause instanceof Error ? cause.message : "Registry verification failed");
      });
  }, [passport.chain.published, passport.run_id]);
  const evidence = passport.canonical_evidence as unknown as EvidenceDetails;
  const canShare = passport.passport_status === "verified"
    && chainVerified === true
    && passport.chain.published
    && passport.payment.status === "settled"
    && passport.target_payment?.status === "settled"
    && passport.gates.paid_delivery === "pass"
    && passport.provider_declaration.verification_state === "verified"
    && (passport.label === "fixture" || passport.label === "external")
    && evidence.execution_mode === "testnet"
    && Boolean(projectCard?.chain.testnet)
    && Boolean(projectCard?.payments.payment_ready)
    && Boolean(projectCard?.payments.pay_to)
    && Boolean(projectCard?.chain.registry_runtime_code_hash)
    && passport.payment.network === projectCard?.chain.network
    && evidence.network === projectCard?.chain.network
    && passport.payment.asset.toLowerCase() === projectCard?.payments.asset.address.toLowerCase()
    && passport.payment.recipient?.toLowerCase() === projectCard?.payments.pay_to?.toLowerCase()
    && passport.chain.registry_address.toLowerCase() === projectCard?.chain.registry_address?.toLowerCase();
  const assetSymbol = projectCard && projectCard.payments.asset.address.toLowerCase() === passport.payment.asset.toLowerCase()
    ? projectCard.payments.asset.symbol
    : passport.payment.asset;
  async function share() {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: "LaunchProof Service Passport", url });
    else await navigator.clipboard.writeText(url);
  }
  return (
    <>
      <section className="passport-hero panel">
        <div>
          <p className="eyebrow">Service Passport · provenance: {passport.label.replaceAll("_", " ")}</p>
          <h1>{String((passport.canonical_evidence as { manifest?: { service_name?: string } }).manifest?.service_name ?? "Agent service")}</h1>
          <p>Rehearsed {new Date(passport.generated_at).toLocaleString()} · {passport.scope}</p>
        </div>
        <div className="passport-actions">
          <StatusBadge status={passport.passport_status} />
          {canShare ? <button className="secondary passport-share" type="button" onClick={share}>Share verified testnet link</button> : null}
        </div>
      </section>
      {passport.payment.status !== "settled" ? <aside className="observed-note"><strong>Unpaid evidence.</strong> This run records LaunchProof payment status <code>{passport.payment.status}</code>. Registry publication, if present, is not proof of payment.</aside> : null}
      {verificationError ? <p className="error">Chain verification could not be confirmed: {verificationError}</p> : null}
      <GateGrid gates={passport.gates} />
      <section className="panel evidence-summary">
        <div className="section-heading"><div><p className="eyebrow">Normalized transcript</p><h2>What the rehearsal observed</h2></div><span className="observed-metric">p95 {evidence.timings?.observed_p95_ms ?? 0} ms · total {evidence.timings?.total_ms ?? 0} ms</span></div>
        <div className="evidence-grid">
          <InvocationCard invocation={evidence.fixed_sample} title="Fixed sample" />
          <InvocationCard invocation={evidence.invalid_input} title="Controlled invalid input" />
          {(evidence.challenges ?? []).map((invocation, index) => <InvocationCard invocation={invocation} title={`Fresh challenge ${index + 1}`} key={`${invocation.kind}-${index}`} />)}
          <InvocationCard invocation={evidence.paid_delivery ?? undefined} title="Paid delivery" />
        </div>
      </section>
      <div className="two-column">
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Evidence publication</p><h2>Registry and hashes</h2></div><span className={passport.chain.published ? "dot-live" : "dot-muted"}>{passport.chain.published ? "Published to registry" : "Not published"}</span></div>
          <CopyValue label="Run ID" value={passport.run_id} />
          <CopyValue label="Evidence hash" value={passport.evidence_hash} />
          <CopyValue label="Manifest hash" value={passport.manifest_hash} />
          <CopyValue label="Input hash" value={passport.input_hash} />
          <CopyValue label="Normalized result hash" value={passport.normalized_result_hash} />
          <CopyValue label="Registry" value={passport.chain.registry_address || "not published"} />
          <div className="button-row">
            {passport.chain.published ? <Link className="secondary" href={`/verify/${encodeURIComponent(passport.run_id)}`}>Cross-check registry storage</Link> : null}
            <a className="text-link" href={`${API_BASE}/runs/${encodeURIComponent(passport.run_id)}`} target="_blank" rel="noreferrer">Raw JSON</a>
            {passport.chain.explorer_url ? <a className="text-link" href={passport.chain.explorer_url} target="_blank" rel="noreferrer">Evidence transaction ↗</a> : null}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Declaration and delivery</p>
          <h2>Who declared it</h2>
          <CopyValue label="Provider" value={passport.provider_declaration.provider_address} />
          <dl className="detail-list">
            <div><dt>Declaration</dt><dd>{passport.provider_declaration.verification_state.replace("_", " ")}</dd></div>
            <div><dt>Provenance</dt><dd>{passport.label.replaceAll("_", " ")}</dd></div>
            <div><dt>Execution mode</dt><dd>{evidence.execution_mode?.replaceAll("_", " ") ?? "not recorded"}</dd></div>
            <div><dt>Evidence network</dt><dd>{evidence.network ?? "not recorded"}</dd></div>
            <div><dt>Registry verification</dt><dd>{chainVerified === null ? "Checking" : chainVerified ? "Hash linkage confirmed" : passport.chain.published ? "Not confirmed" : "Not published"}</dd></div>
            <div><dt>Source revision</dt><dd>{passport.source_version_sha}</dd></div>
            <div><dt>Build commit</dt><dd>{passport.build_commit_sha}</dd></div>
            <div><dt>LaunchProof payment</dt><dd><Link href={`/receipts/${encodeURIComponent(passport.payment.payment_id)}`}>{paymentDisplayAmount(passport.payment)} {assetSymbol} · {passport.payment.status.replaceAll("_", " ")}</Link></dd></div>
            <div><dt>Payment network</dt><dd>{passport.payment.network}</dd></div>
            <div><dt>Target payment</dt><dd>{passport.target_payment ? <Link href={`/receipts/${encodeURIComponent(passport.target_payment.payment_id)}`}>{paymentDisplayAmount(passport.target_payment)} · {passport.target_payment.status.replaceAll("_", " ")}</Link> : passport.gates.paid_delivery === "not_tested" ? "Not tested" : "No settlement recorded"}</dd></div>
          </dl>
          {passport.previous_run_id ? <Link className="text-link" href={`/compare?left=${encodeURIComponent(passport.previous_run_id)}&right=${encodeURIComponent(passport.run_id)}`}>Compare with prior version →</Link> : null}
        </section>
      </div>
      {passport.remediation.length ? <section className="panel"><p className="eyebrow">Deterministic remediation</p><h2>What to inspect</h2><ul className="remediation">{passport.remediation.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
      <section className="panel passport-limitations"><p className="eyebrow">Scope and limitations</p><h2>What this Passport does not claim</h2><ul className="remediation">{passport.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <details className="panel raw"><summary>Raw canonical evidence</summary><pre>{JSON.stringify(passport.canonical_evidence, null, 2)}</pre></details>
      <Disclaimers />
    </>
  );
}

interface EvidenceDetails {
  network?: string;
  execution_mode?: "local" | "testnet" | "mainnet";
  timings?: { observed_p95_ms: number; total_ms: number };
  fixed_sample?: Invocation;
  invalid_input?: Invocation;
  challenges?: Invocation[];
  paid_delivery?: Invocation | null;
}

interface Invocation {
  kind: string;
  latency_ms: number;
  classification: string | null;
  structured_error?: { code: string | number; message: string } | null;
  comparisons?: Array<{ field: string; expected: unknown; actual: unknown; match: boolean }>;
}

function InvocationCard({ invocation, title }: { invocation: Invocation | undefined; title: string }) {
  if (!invocation) return null;
  const passed = invocation.classification === null;
  return (
    <article className="invocation-card">
      <div><span className={passed ? "invocation-pass" : "invocation-fail"}>{passed ? "PASS" : "FAIL"}</span><small>{invocation.latency_ms} ms</small></div>
      <h3>{title}</h3>
      {invocation.classification ? <p>Classification: <code>{invocation.classification}</code></p> : null}
      {invocation.structured_error ? <p>Structured error: <code>{String(invocation.structured_error.code)}</code></p> : null}
      {(invocation.comparisons ?? []).length ? <ul>{invocation.comparisons!.map((comparison) => <li key={comparison.field}><span>{comparison.match ? "match" : "mismatch"}</span><code>{comparison.field}</code><small>{display(comparison.actual)} / {display(comparison.expected)}</small></li>)}</ul> : null}
    </article>
  );
}

function display(value: unknown) {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return rendered && rendered.length > 80 ? `${rendered.slice(0, 77)}...` : (rendered ?? "missing");
}
