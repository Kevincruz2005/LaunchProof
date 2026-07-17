"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/generated-api/client";

export function ResourceView({ path, title, eyebrow }: { path: string; title: string; eyebrow: string }) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void apiGet(path).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "Request failed")); }, [path]);
  return <main className="page"><section className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></section>{error ? <p className="error">{error}</p> : data !== null ? <pre className="resource-json">{JSON.stringify(data, null, 2)}</pre> : <div className="loading">Reading public evidence…</div>}</main>;
}
