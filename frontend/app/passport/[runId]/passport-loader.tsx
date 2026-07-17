"use client";

import { useEffect, useState } from "react";
import { apiGet, pollRun, type Passport, type RunProgress } from "../../../lib/generated-api/client";
import { PassportView } from "../../../components/passport-view";

export function PassportLoader({ runId }: { runId: string }) {
  const [run, setRun] = useState<Passport | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const initial = await apiGet<Passport | RunProgress>(`/runs/${encodeURIComponent(runId)}`);
      if (initial.state === "complete" || initial.state === "complete_local") {
        if (!cancelled) setRun(initial as Passport);
        return;
      }
      if (!cancelled) setProgress(initial.state);
      const completed = await pollRun(runId, (value) => { if (!cancelled) setProgress(value.state); });
      if (!cancelled) setRun(completed);
    })().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Passport unavailable"); });
    return () => { cancelled = true; };
  }, [runId]);

  if (error) return <p className="error">{error}</p>;
  if (!run) return <div className="loading">Run state: {progress?.replaceAll("_", " ") ?? "loading"}…</div>;
  return <PassportView passport={run} />;
}
