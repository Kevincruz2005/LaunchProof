"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearPendingRun,
  connectWallet,
  forgetConnectedWallet,
  getProjectCard,
  loadPendingRun,
  pollRun,
  rememberConnectedWallet,
  restoreConnectedWallet,
  savePendingRun,
  subscribeToInjectedWallet,
  submitRun,
  testnetPaymentAnchorError,
  type PaymentMode,
  type PendingRun,
  type ProjectCard,
} from "../lib/generated-api/client";

const progressIndex: Record<string, number> = {
  payment_required: 0,
  settlement_claimed: 0,
  payment_ambiguous: 0,
  payment_settled: 1,
  queued: 1,
  fetching_contract: 2,
  discovering: 3,
  fixed_sample: 4,
  invalid_input: 5,
  fresh_challenges: 6,
  target_payment_or_not_tested: 7,
  canonicalizing: 7,
  publishing_on_chain: 8,
  complete: 9,
  complete_local: 9,
};

export function RehearsalForm({ expanded = false }: { expanded?: boolean }) {
  const router = useRouter();
  const recoveryStarted = useRef(false);
  const [projectCard, setProjectCard] = useState<ProjectCard | null>(null);
  const [url, setUrl] = useState("");
  const [runKind, setRunKind] = useState<"first" | "renew">("first");
  const [previousRunId, setPreviousRunId] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("paid");
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [savedAttempt, setSavedAttempt] = useState<PendingRun | null>(null);
  const [state, setState] = useState("loading_configuration");
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState(0);
  const [runStarted, setRunStarted] = useState(false);

  const busy = !["idle", "failed", "completed", "configuration_error"].includes(state);
  const paymentAnchorError = projectCard ? testnetPaymentAnchorError(projectCard) : null;
  const paidReady = Boolean(
    projectCard?.payments.x402_enabled
    && projectCard.payments.payment_ready
    && projectCard.payments.pay_to
    && projectCard.chain.registry_address
    && projectCard.chain.registry_runtime_code_hash
    && projectCard.chain.testnet
    && !paymentAnchorError,
  );
  const selectedCapability = paymentMode === "paid"
    ? paidReady
    : projectCard?.payments.local_unpaid_enabled === true;
  const canSubmit = useMemo(
    () => Boolean(
      projectCard
      && selectedCapability
      && url
      && (runKind === "first" || previousRunId)
      && (paymentMode === "local" || account),
    ),
    [account, paymentMode, previousRunId, projectCard, runKind, selectedCapability, url],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const card = await getProjectCard();
      if (cancelled) return;
      setProjectCard(card);
      setAccount(await restoreConnectedWallet(card));
      if (cancelled) return;
      const pending = loadPendingRun();
      if (pending) {
        setSavedAttempt(pending);
        setUrl(pending.url);
        setPaymentMode(pending.paymentMode);
        if (pending.previousRunId) {
          setRunKind("renew");
          setPreviousRunId(pending.previousRunId);
        }
      } else {
        setPaymentMode(card.payments.payment_ready && card.payments.pay_to && card.chain.registry_address && card.chain.registry_runtime_code_hash && card.chain.testnet ? "paid" : "local");
      }
      setState("idle");
      if (pending?.runId && !recoveryStarted.current) {
        recoveryStarted.current = true;
        setRunStarted(true);
        await trackRun(pending.runId);
      }
    })().catch((cause) => {
      if (!cancelled) {
        setState("configuration_error");
        setError(cause instanceof Error ? cause.message : "Could not load the public chain and payment policy.");
      }
    });
    return () => { cancelled = true; };
  // `trackRun` only uses stable React setters and the router instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!projectCard) return;
    let cancelled = false;
    const syncWallet = () => {
      void restoreConnectedWallet(projectCard).then((restored) => {
        if (!cancelled) setAccount(restored);
      });
    };
    const unsubscribe = subscribeToInjectedWallet(syncWallet);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectCard]);

  async function trackRun(runId: string) {
    setState("run_in_progress");
    try {
      const result = await pollRun(runId, (run) => {
        setActiveStage((current) => progressIndex[run.state] ?? current);
        setState(run.state);
      });
      clearPendingRun();
      setSavedAttempt(null);
      setState("completed");
      router.push(`/passport/${encodeURIComponent(result.run_id)}`);
    } catch (cause) {
      setState("failed");
      setError(cause instanceof Error ? cause.message : "Rehearsal failed");
    }
  }

  async function connect(requestAccountSelection = false) {
    if (!projectCard) return;
    setError(null);
    setState("connecting_wallet");
    try {
      const connectedAccount = await connectWallet(projectCard, requestAccountSelection);
      rememberConnectedWallet(connectedAccount);
      setAccount(connectedAccount);
      setState("idle");
    } catch (cause) {
      setState("failed");
      setError(cause instanceof Error ? cause.message : "Wallet connection failed");
    }
  }

  async function disconnect() {
    setError(null);
    setState("connecting_wallet");
    await forgetConnectedWallet();
    setAccount(null);
    setState("idle");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !projectCard) return;
    setError(null);
    setRunStarted(true);
    setState(paymentMode === "paid" ? "payment_pending" : "local_authorization");
    setActiveStage(0);

    const sameDraft = savedAttempt
      && !savedAttempt.runId
      && savedAttempt.url === url
      && savedAttempt.paymentMode === paymentMode
      && (savedAttempt.previousRunId ?? "") === (runKind === "renew" ? previousRunId : "");
    const pending: PendingRun = {
      idempotencyKey: sameDraft ? savedAttempt.idempotencyKey : crypto.randomUUID(),
      url,
      paymentMode,
      createdAt: sameDraft ? savedAttempt.createdAt : new Date().toISOString(),
      ...(runKind === "renew" ? { previousRunId } : {}),
    };
    savePendingRun(pending);
    setSavedAttempt(pending);

    try {
      const started = await submitRun({
        url,
        idempotencyKey: pending.idempotencyKey,
        paymentMode,
        projectCard,
        ...(account ? { account } : {}),
        ...(runKind === "renew" ? { previousRunId } : {}),
      });
      const tracked = { ...pending, runId: started.run_id };
      savePendingRun(tracked);
      setSavedAttempt(tracked);
      await trackRun(started.run_id);
    } catch (cause) {
      setState("failed");
      setError(cause instanceof Error ? cause.message : "Rehearsal failed");
    }
  }

  function forgetSavedAttempt() {
    clearPendingRun();
    setSavedAttempt(null);
    setRunStarted(false);
    setState("idle");
    setError(null);
  }

  const price = runKind === "renew" ? projectCard?.payments.renewal_amount : projectCard?.payments.genesis_amount;
  const atomicPrice = runKind === "renew" ? projectCard?.payments.renewal_amount_atomic : projectCard?.payments.genesis_amount_atomic;
  const symbol = projectCard?.payments.asset.symbol ?? "configured token";
  const stages = [
    paymentMode === "paid" ? "Payment authorization" : "Local run authorization",
    "Run queued",
    "Contract fetched",
    "Tool discovered",
    "Fixed sample",
    "Invalid input",
    "Fresh challenges",
    "Target payment evaluated",
    "Evidence publication",
  ];

  return (
    <section className={`rehearsal-shell ${expanded ? "rehearsal-expanded" : ""}`}>
      <form onSubmit={submit} className="rehearsal-form">
        {paymentMode === "paid" ? (
          <div className="wallet-row">
            <div><small>Wallet · this tab</small><strong>{account ? shortAddress(account) : "Not connected"}</strong></div>
            <div className="wallet-actions">
              <button className="secondary" disabled={busy || !paidReady} type="button" onClick={() => void connect(Boolean(account))}>{account ? "Change wallet" : "Connect wallet"}</button>
              {account ? <button className="secondary" disabled={busy} type="button" onClick={() => void disconnect()}>Disconnect</button> : null}
            </div>
          </div>
        ) : <p className="local-note">Local mode is development-only. Its Passport and receipt must remain marked unpaid/local.</p>}

        <div className="segmented" role="group" aria-label="Passport mode">
          <button className={runKind === "first" ? "active" : ""} disabled={busy} type="button" onClick={() => setRunKind("first")}>First version{projectCard ? ` · ${projectCard.payments.genesis_amount}` : ""}</button>
          <button className={runKind === "renew" ? "active" : ""} disabled={busy} type="button" onClick={() => setRunKind("renew")}>Renew{projectCard ? ` · ${projectCard.payments.renewal_amount}` : ""}</button>
        </div>

        <fieldset className="payment-mode" disabled={busy || !projectCard}>
          <legend>Execution authorization</legend>
          <label className={paymentMode === "paid" ? "selected" : ""}>
            <input
              checked={paymentMode === "paid"}
              disabled={!paidReady}
              name="payment-mode"
              onChange={() => setPaymentMode("paid")}
              type="radio"
            />
            <span><strong>Paid x402 testnet</strong><small>{paidReady ? `${price ?? "—"} ${symbol} · ${projectCard?.chain.name ?? "configured testnet"}` : !projectCard?.payments.x402_enabled ? "Not enabled by this deployment" : paymentAnchorError ?? "Incomplete testnet payment or registry configuration"}</small></span>
          </label>
          <label className={paymentMode === "local" ? "selected" : ""}>
            <input
              checked={paymentMode === "local"}
              disabled={!projectCard?.payments.local_unpaid_enabled}
              name="payment-mode"
              onChange={() => setPaymentMode("local")}
              type="radio"
            />
            <span><strong>Local unpaid</strong><small>{projectCard?.payments.local_unpaid_enabled ? "No settlement; never presented as paid" : "Disabled by this deployment"}</small></span>
          </label>
        </fieldset>

        <label>Provider domain or Launch Contract URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://provider.example" required /></label>
        {runKind === "renew" ? <label>Previous run ID<input value={previousRunId} onChange={(event) => setPreviousRunId(event.target.value)} placeholder="0x…" required /></label> : null}

        {projectCard ? <p className="run-policy">Expected payment policy: <code>exact</code> · <code>{projectCard.chain.network}</code> · {atomicPrice} atomic units ({projectCard.payments.asset.decimals} decimals) · asset <code>{shortAddress(projectCard.payments.asset.address)}</code> · recipient <code>{projectCard.payments.pay_to ? shortAddress(projectCard.payments.pay_to) : "not configured"}</code></p> : null}
        <button className="primary" type="submit" disabled={!canSubmit || busy}>
          {submitLabel(state, paymentMode)} <span aria-hidden="true">→</span>
        </button>

        {savedAttempt ? (
          <div className="saved-run-note">
            <span>{savedAttempt.runId ? <>Tracking saved run <code>{shortAddress(savedAttempt.runId)}</code>.</> : "A retry-safe idempotency key is saved for this request."}</span>
            {!busy ? <button type="button" onClick={forgetSavedAttempt}>Forget</button> : null}
          </div>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </form>
      {(expanded || runStarted) ? (
        <div className="progress-panel" aria-live="polite">
          <p className="eyebrow">Run state · {state.replaceAll("-", " ").replaceAll("_", " ")}</p>
          <ol>{stages.map((stage, index) => <li className={runStarted && index < activeStage ? "done" : runStarted && index === activeStage ? "active" : ""} key={stage}><span>{runStarted && index < activeStage ? "✓" : index + 1}</span>{stage}</li>)}</ol>
        </div>
      ) : null}
    </section>
  );
}

function shortAddress(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function submitLabel(state: string, paymentMode: PaymentMode) {
  if (state === "loading_configuration") return "Loading public policy";
  if (state === "connecting_wallet") return "Connecting wallet";
  if (!["idle", "failed", "completed", "configuration_error"].includes(state)) return "Rehearsal in progress";
  return paymentMode === "paid" ? "Approve payment and rehearse" : "Start unpaid local rehearsal";
}
