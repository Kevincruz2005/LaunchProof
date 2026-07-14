"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { connectWallet, pollRun, submitPaidRun } from "../lib/generated-api/client";

const stages = ["Payment approved", "Contract fetched", "Tool discovered", "Fixed sample", "Invalid input", "Fresh challenges", "Target payment", "Evidence anchored"];

export function RehearsalForm({ expanded = false }: { expanded?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"first" | "renew">("first");
  const [previousRunId, setPreviousRunId] = useState("");
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [state, setState] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState(0);
  const price = mode === "renew" ? "0.10" : "0.01";
  const busy = !["idle", "failed", "completed"].includes(state);
  const canSubmit = useMemo(() => Boolean(url && (localOnly || wallet) && (mode === "first" || previousRunId)), [url, localOnly, wallet, mode, previousRunId]);

  async function connect() {
    try { setError(null); setWallet(await connectWallet()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet connection failed"); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setState("payment-pending");
    setActiveStage(0);
    try {
      const started = await submitPaidRun({
        url,
        idempotencyKey: crypto.randomUUID(),
        localOnly,
        ...(wallet ? { account: wallet } : {}),
        ...(mode === "renew" ? { previousRunId } : {}),
      });
      setState("run-in-progress");
      const result = await pollRun(started.run_id, (run) => {
        const index: Record<string, number> = { fetching_contract: 1, discovering: 2, fixed_sample: 3, invalid_input: 4, fresh_challenges: 5, target_payment_or_not_tested: 6, canonicalizing: 6, publishing_on_chain: 7 };
        setActiveStage((current) => index[run.state] ?? current);
        setState(run.state);
      });
      setState("completed");
      router.push(`/passport/${encodeURIComponent(result.run_id)}`);
    } catch (cause) {
      setState("failed");
      setError(cause instanceof Error ? cause.message : "Rehearsal failed");
    }
  }

  return (
    <section className={`rehearsal-shell ${expanded ? "rehearsal-expanded" : ""}`}>
      <form onSubmit={submit} className="rehearsal-form">
        <div className="segmented" role="group" aria-label="Passport mode">
          <button className={mode === "first" ? "active" : ""} type="button" onClick={() => setMode("first")}>First version · 0.01</button>
          <button className={mode === "renew" ? "active" : ""} type="button" onClick={() => setMode("renew")}>Renew · 0.10</button>
        </div>
        <label>Provider domain or Launch Contract URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://provider.example" required /></label>
        {mode === "renew" ? <label>Previous run ID<input value={previousRunId} onChange={(event) => setPreviousRunId(event.target.value)} placeholder="0x…" required /></label> : null}
        <div className="payment-row">
          <button className="secondary" type="button" onClick={connect}>{wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Connect OKX Wallet"}</button>
          <label className="check"><input type="checkbox" checked={localOnly} onChange={(event) => setLocalOnly(event.target.checked)} /> Local-only developer run</label>
        </div>
        <button className="primary" type="submit" disabled={!canSubmit || busy}>{busy ? "Rehearsal in progress" : localOnly ? "Run local-only rehearsal" : `Approve ${price} USDT0 and rehearse`} <span aria-hidden="true">→</span></button>
        {localOnly ? <p className="local-note">Local-only runs are never public proof and are not published as mainnet Passports.</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </form>
      {(expanded || state !== "idle") ? <div className="progress-panel" aria-live="polite"><p className="eyebrow">Run state · {state.replaceAll("-", " ")}</p><ol>{stages.map((stage, index) => <li className={index < activeStage ? "done" : index === activeStage && state !== "idle" ? "active" : ""} key={stage}><span>{index < activeStage ? "✓" : index + 1}</span>{stage}</li>)}</ol></div> : null}
    </section>
  );
}
