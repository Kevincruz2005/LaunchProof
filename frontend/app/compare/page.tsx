"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiGet, type Passport } from "../../lib/generated-api/client";
import { GateGrid } from "../../components/gates";
import { CopyValue } from "../../components/copy-value";

export default function ComparePage() {
  return <Suspense fallback={<main className="page"><div className="loading">Preparing comparison…</div></main>}><CompareContent /></Suspense>;
}

function CompareContent() {
  const query = useSearchParams();
  const leftId = query.get("left");
  const rightId = query.get("right");
  const [runs, setRuns] = useState<[Passport, Passport] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leftId || !rightId) return;
    void Promise.all([
      apiGet<Passport>(`/runs/${encodeURIComponent(leftId)}`),
      apiGet<Passport>(`/runs/${encodeURIComponent(rightId)}`),
    ]).then((value) => setRuns(value as [Passport, Passport]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Comparison failed"));
  }, [leftId, rightId]);

  return (
    <main className="page">
      <section className="page-title"><p className="eyebrow">Observed values from each run</p><h1>Passport comparison</h1><p>Gate, provenance, payment, publication, and source states are shown independently.</p></section>
      {!leftId || !rightId ? <p className="error">Provide both left and right run IDs.</p> : error ? <p className="error">{error}</p> : !runs ? <div className="loading">Loading both Passports…</div> : (
        <div className="compare-grid">{runs.map((run, index) => (
          <section className="panel" key={run.run_id}>
            <p className="eyebrow">{index === 0 ? "Before / left" : "After / right"}</p>
            <h2>{run.passport_status}</h2>
            <CopyValue label="Run ID" value={run.run_id} />
            <GateGrid gates={run.gates} />
            <dl className="detail-list">
              <div><dt>Provenance</dt><dd>{run.label.replaceAll("_", " ")}</dd></div>
              <div><dt>Execution mode</dt><dd>{String((run.canonical_evidence as { execution_mode?: string }).execution_mode ?? "not recorded")}</dd></div>
              <div><dt>Payment</dt><dd>{run.payment.status.replaceAll("_", " ")}</dd></div>
              <div><dt>Publication</dt><dd>{run.chain.published ? "published" : "not published"}</dd></div>
              <div><dt>Source</dt><dd>{run.source_version_sha}</dd></div>
              <div><dt>Build</dt><dd>{run.build_commit_sha}</dd></div>
              <div><dt>Generated</dt><dd>{new Date(run.generated_at).toLocaleString()}</dd></div>
            </dl>
          </section>
        ))}</div>
      )}
    </main>
  );
}
