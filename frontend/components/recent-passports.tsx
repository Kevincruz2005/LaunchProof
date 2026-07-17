"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, type Passport } from "../lib/generated-api/client";
import { StatusBadge } from "./gates";

export function RecentPassports() {
  const [runs, setRuns] = useState<Passport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiGet<{ runs: Passport[] }>("/runs")
      .then((response) => setRuns(response.runs.slice(0, 3)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Recent runs are unavailable"));
  }, []);
  if (runs === null && !error) return <section className="recent-passports"><p className="eyebrow">Recent completed runs</p><div className="loading compact">Reading the configured run index...</div></section>;
  return (
    <section className="recent-passports">
      <div className="section-heading"><div><p className="eyebrow">Recent completed runs</p><h2>Inspect payment, provenance, and publication</h2></div><Link className="text-link" href="/status">Observed status</Link></div>
      {error ? <p className="error">The run index could not be loaded: {error}</p> : runs?.length === 0 ? <div className="panel empty-state">No completed Passports are indexed in this environment yet.</div> : runs ? (
        <div className="recent-grid">{runs.map((run) => (
          <Link className="panel recent-card" href={`/passport/${encodeURIComponent(run.run_id)}`} key={run.run_id}>
            <StatusBadge status={run.passport_status} />
            <h3>{String((run.canonical_evidence as { manifest?: { service_name?: string } }).manifest?.service_name ?? "Agent service")}</h3>
            <code>{short(run.run_id)}</code>
            <small>{new Date(run.generated_at).toLocaleString()} · {run.label.replaceAll("_", " ")} · {run.payment.status.replaceAll("_", " ")} · {run.chain.published ? "published" : "not published"}</small>
          </Link>
        ))}</div>
      ) : null}
    </section>
  );
}

function short(value: string) { return value.length > 26 ? `${value.slice(0, 14)}...${value.slice(-8)}` : value; }
