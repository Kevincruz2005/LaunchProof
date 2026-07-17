import type { GateState } from "../lib/generated-api/client";

const labels: Record<string, string> = {
  discoverable: "Discoverable",
  contract_correct: "Contract correct",
  fresh_challenge: "Fresh challenge",
  safe_to_rehearse: "Safe to rehearse",
  paid_delivery: "Paid delivery",
};

export function GateGrid({ gates }: { gates: Record<string, GateState> }) {
  return (
    <div className="gate-grid">
      {Object.entries(gates).map(([name, state]) => (
        <article className={`gate gate-${state}`} key={name}>
          <span className="gate-icon" aria-hidden="true">{state === "pass" ? "✓" : state === "fail" ? "×" : "—"}</span>
          <div><strong>{labels[name] ?? name}</strong><small>{state.replace("_", " ")}</small></div>
        </article>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status === "verified"
    ? "gates verified"
    : status === "needs-attention"
      ? "gates need attention"
      : status.replaceAll("_", " ");
  return <span className={`status status-${status}`}>{status === "verified" ? "✓" : status === "needs-attention" ? "!" : "—"} {normalized}</span>;
}
