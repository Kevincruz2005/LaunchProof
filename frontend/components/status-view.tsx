"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, type Passport, type PublicChainPolicy, type PublicPaymentPolicy } from "../lib/generated-api/client";
import { StatusBadge } from "./gates";

interface StatusResponse {
  observed_at: string;
  service: string;
  listing: string;
  prices: { genesis_rehearsal: string; renew_passport: string };
  registry: string | null;
  chain: PublicChainPolicy;
  payments: PublicPaymentPolicy;
  recent_runs: Passport[];
  disclaimer: string;
}

export function StatusView() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiGet<StatusResponse>("/status").then(setStatus).catch((cause) => setError(cause instanceof Error ? cause.message : "Status request failed"));
  }, []);

  return (
    <main className="page">
      <section className="page-title"><p className="eyebrow">Historical facts, never an SLA</p><h1>Observed service status</h1><p>A live configuration snapshot and the most recent completed rehearsals.</p></section>
      {error ? <p className="error">{error}</p> : null}
      {!status && !error ? <div className="loading">Reading public evidence...</div> : status ? (
        <>
          <section className="status-summary">
            <article className="panel"><small>Service configuration</small><strong>{humanize(status.service)}</strong></article>
            <article className="panel"><small>x402 payments</small><strong>{status.payments.payment_ready ? "ready" : status.payments.x402_enabled ? "configured but incomplete" : "disabled"}</strong></article>
            <article className="panel"><small>Observed</small><strong>{formatDate(status.observed_at)}</strong></article>
          </section>
          <section className="two-column">
            <article className="panel">
              <p className="eyebrow">Published payment policy</p><h2>Rehearsal authorization</h2>
              <dl className="detail-list">
                <div><dt>Genesis</dt><dd>{status.payments.genesis_amount} {status.payments.asset.symbol}</dd></div>
                <div><dt>Renewal</dt><dd>{status.payments.renewal_amount} {status.payments.asset.symbol}</dd></div>
                <div><dt>Asset</dt><dd><code>{status.payments.asset.address}</code></dd></div>
                <div><dt>Asset decimals</dt><dd>{status.payments.asset.decimals}</dd></div>
                <div><dt>Recipient</dt><dd><code>{status.payments.pay_to ?? "not configured"}</code></dd></div>
                <div><dt>Local unpaid</dt><dd>{status.payments.local_unpaid_enabled ? "enabled for this deployment" : "disabled"}</dd></div>
              </dl>
            </article>
            <article className="panel">
              <p className="eyebrow">Configured chain publication</p><h2>{status.chain.name}</h2>
              <dl className="detail-list">
                <div><dt>Chain ID</dt><dd>{status.chain.id}</dd></div>
                <div><dt>Network</dt><dd>{status.chain.network}</dd></div>
                <div><dt>Testnet</dt><dd>{status.chain.testnet ? "yes" : "no"}</dd></div>
                <div><dt>Registry</dt><dd className="mono-wrap">{status.chain.registry_address ?? "not configured"}</dd></div>
                <div><dt>Start block</dt><dd>{status.chain.registry_deployment_block}</dd></div>
                <div><dt>Runtime code hash</dt><dd className="mono-wrap">{status.chain.registry_runtime_code_hash ?? "not configured"}</dd></div>
              </dl>
            </article>
          </section>
          <section className="panel run-history">
            <p className="eyebrow">Latest evidence</p><h2>Completed rehearsals</h2>
            {status.recent_runs.length === 0 ? <p className="empty-state">No completed rehearsals have been recorded in this environment.</p> : status.recent_runs.map((run) => (
              <Link className="run-row" href={`/passport/${encodeURIComponent(run.run_id)}`} key={run.run_id}>
                <div><code>{short(run.run_id)}</code><small>{formatDate(run.generated_at)} · {run.label.replaceAll("_", " ")} · {run.payment.status.replaceAll("_", " ")} · {run.chain.published ? "published" : "not published"}</small></div>
                <StatusBadge status={run.passport_status} />
              </Link>
            ))}
          </section>
          <aside className="observed-note"><strong>Point-in-time record.</strong> {status.disclaimer}</aside>
        </>
      ) : null}
    </main>
  );
}

function humanize(value: string) { return value.replaceAll("_", " "); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function short(value: string) { return value.length > 24 ? `${value.slice(0, 14)}...${value.slice(-8)}` : value; }
