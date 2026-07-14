"use client";
import { useEffect, useState } from "react";
import { apiGet, type Passport } from "../../../lib/generated-api/client";
import { PassportView } from "../../../components/passport-view";
export function PassportLoader({ runId }: { runId: string }) { const [run, setRun] = useState<Passport | null>(null); const [error, setError] = useState<string | null>(null); useEffect(() => { void apiGet<Passport>(`/runs/${encodeURIComponent(runId)}`).then(setRun).catch((cause) => setError(cause instanceof Error ? cause.message : "Passport unavailable")); }, [runId]); if (error) return <p className="error">{error}</p>; if (!run) return <div className="loading">Reconstructing the Passport…</div>; return <PassportView passport={run} />; }
