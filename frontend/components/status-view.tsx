"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, type Passport } from "../lib/generated-api/client";
import { StatusBadge } from "./gates";

interface StatusResponse {
  observed_at: string;
  service: string;
  listing: string;
  prices: { genesis_rehearsal: string; renew_passport: string };
  registry: string | null;
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
      {!status ? <div className="loading">Reading public evidence...</div> : (
        <>
          <section className="status-summary">
            <article className="panel"><small>Service</small><strong>{humanize(status.service)}</strong></article>
            <article className="panel"><small>OKX listing</small><strong>{humanize(status.listing)}</strong></article>
            <article className="panel"><small>Observed</small><strong>{formatDate(status.observed_at)}</strong></article>
          </section>
          <section className="two-column">
            <article className="panel">
              <p className="eyebrow">Fixed public prices</p><h2>Rehearsal fees</h2>
              <dl className="detail-list"><div><dt>Genesis</dt><dd>{status.prices.genesis_rehearsal}</dd></div><div><dt>Renewal</dt><dd>{status.prices.renew_passport}</dd></div></dl>
            </article>
            <article className="panel">
              <p className="eyebrow">Immutable evidence</p><h2>Registry</h2>
              <p className="mono-wrap">{status.registry ?? "Registry is not configured in this environment."}</p>
            </article>
          </section>
          <section className="panel run-history">
            <p className="eyebrow">Latest evidence</p><h2>Completed rehearsals</h2>
            {status.recent_runs.length === 0 ? <p className="empty-state">No completed rehearsals have been recorded in this environment.</p> : status.recent_runs.map((run) => (
              <Link className="run-row" href={`/passport/${encodeURIComponent(run.run_id)}`} key={run.run_id}>
                <div><code>{short(run.run_id)}</code><small>{formatDate(run.generated_at)} · {run.label.replaceAll("_", " ")}</small></div>
                <StatusBadge status={run.passport_status} />
              </Link>
            ))}
          </section>
          <aside className="observed-note"><strong>Point-in-time record.</strong> {status.disclaimer}</aside>
        </>
      )}
    </main>
  );
}

function humanize(value: string) { return value.replaceAll("_", " "); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function short(value: string) { return value.length > 24 ? `${value.slice(0, 14)}...${value.slice(-8)}` : value; }
