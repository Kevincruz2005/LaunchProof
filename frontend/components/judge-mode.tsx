"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  checkServicePassport,
  getControlledFixtures,
  type ControlledFixture,
  type PassportGateDecisionResult,
  type PassportGateResult,
  type PassportGateSettlement,
} from "../lib/generated-api/client";

const gateLabels: Record<string, string> = {
  discoverable: "Discoverable",
  contract_correct: "Contract correct",
  fresh_challenge: "Fresh challenge",
  safe_to_rehearse: "Safe to rehearse",
  paid_delivery: "Paid delivery",
};

type FixtureLoader = () => Promise<ControlledFixture[]>;
type PassportChecker = (url: string) => Promise<PassportGateResult>;

export function JudgeMode({
  loadFixtures = getControlledFixtures,
  checkPassport = checkServicePassport,
}: {
  loadFixtures?: FixtureLoader;
  checkPassport?: PassportChecker;
}) {
  const [fixtures, setFixtures] = useState<ControlledFixture[] | null>(null);
  const [selectedVariant, setSelectedVariant] = useState("");
  const [launchContractUrl, setLaunchContractUrl] = useState("");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<PassportGateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFixtures()
      .then((catalog) => {
        if (cancelled) return;
        setFixtures(catalog);
        const healthy = catalog.find((fixture) => fixture.variant === "healthy" && fixture.launch_contract);
        if (healthy?.launch_contract) {
          setSelectedVariant(healthy.variant);
          setLaunchContractUrl(healthy.launch_contract);
        }
      })
      .catch((cause) => {
        if (!cancelled) setCatalogError(cause instanceof Error ? cause.message : "The controlled fixture catalog is unavailable.");
      });
    return () => { cancelled = true; };
  }, [loadFixtures]);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  function chooseFixture(variant: string) {
    setSelectedVariant(variant);
    const fixture = fixtures?.find((candidate) => candidate.variant === variant);
    setLaunchContractUrl(fixture?.launch_contract ?? "");
    setResult(null);
    setError(null);
    setShareStatus(null);
  }

  async function check(event: React.FormEvent) {
    event.preventDefault();
    if (!launchContractUrl || checking) return;
    setChecking(true);
    setResult(null);
    setError(null);
    setShareStatus(null);
    try {
      setResult(await checkPassport(launchContractUrl));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PassportGate failed without making a trust decision.");
    } finally {
      setChecking(false);
    }
  }

  async function sharePassport(resultValue: PassportGateDecisionResult) {
    if (!resultValue.passport_url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "LaunchProof Service Passport", url: resultValue.passport_url });
        setShareStatus("Passport shared.");
      } else {
        await navigator.clipboard.writeText(resultValue.passport_url);
        setShareStatus("Passport link copied.");
      }
    } catch (cause) {
      if (isUserRejection(cause)) setShareStatus("Sharing cancelled.");
      else setShareStatus("The Passport link could not be copied.");
    }
  }

  const configuredFixtures = fixtures?.filter((fixture) => fixture.launch_contract) ?? [];
  const catalogEmpty = fixtures !== null && !fixtures.some((fixture) => fixture.variant === "healthy" && fixture.launch_contract);

  return (
    <main className="judge-page">
      <section className="judge-intro" aria-labelledby="judge-title">
        <div>
          <p className="eyebrow">Judge Mode · X Layer Testnet</p>
          <h1 id="judge-title">Ask before<br /><em>agents pay.</em></h1>
        </div>
        <p className="judge-problem">Before an AI agent hires an ASP, ask for its LaunchProof Passport.</p>
      </section>

      <section className="judge-console" aria-label="PassportGate service check">
        <form className="judge-form" onSubmit={check}>
          <div className="judge-form-heading">
            <div><p className="eyebrow">Read-only trust gate</p><h2>Check a service</h2></div>
            <span className="testnet-pill">X Layer Testnet</span>
          </div>
          <p className="judge-no-wallet">No wallet, signature, or payment is requested by this check. Paid rehearsal always requires a separate explicit approval.</p>

          {catalogError ? <div className="judge-state judge-state-error" role="alert"><strong>Fixture catalog unavailable</strong><span>{catalogError}</span></div> : null}
          {!fixtures && !catalogError ? <div className="judge-catalog-loading" role="status">Loading the backend fixture catalog…</div> : null}
          {catalogEmpty ? <div className="judge-state judge-state-empty" role="status"><strong>No healthy controlled fixture is configured</strong><span>Judge Mode will not substitute or hardcode a target URL.</span></div> : null}

          <label htmlFor="judge-fixture">Controlled fixture</label>
          <select
            disabled={configuredFixtures.length === 0 || checking}
            id="judge-fixture"
            onChange={(event) => chooseFixture(event.target.value)}
            value={selectedVariant}
          >
            {configuredFixtures.length === 0 ? <option value="">No configured fixtures</option> : configuredFixtures.map((fixture) => (
              <option key={fixture.variant} value={fixture.variant}>{fixture.variant.replaceAll("-", " ")} · {fixture.intended_outcome}</option>
            ))}
          </select>

          <label htmlFor="judge-url">Launch Contract URL</label>
          <input
            disabled={checking}
            id="judge-url"
            onChange={(event) => {
              setLaunchContractUrl(event.target.value);
              setSelectedVariant("");
              setResult(null);
              setError(null);
            }}
            placeholder="Loaded from the backend fixture catalog"
            required
            type="url"
            value={launchContractUrl}
          />
          <button className="primary judge-check" disabled={!launchContractUrl || checking || Boolean(catalogError)} type="submit">
            {checking ? "Verifying current proof…" : "Check Service Passport"}<span aria-hidden="true">→</span>
          </button>
          {error ? <div className="judge-state judge-state-error" role="alert"><strong>No decision made</strong><span>{error}</span></div> : null}
        </form>

        <div className="judge-output" aria-busy={checking} aria-live="polite">
          {checking ? <JudgeLoading /> : result?.operational_status === "UNAVAILABLE" ? (
            <section className="judge-unavailable" ref={resultRef} tabIndex={-1}>
              <p className="eyebrow">PassportGate unavailable</p>
              <h2>No trust decision</h2>
              <p>{result.explanation}</p>
              <div className="judge-reasons">{result.reason_codes.map((reason) => <code key={reason}>{humanize(reason)}</code>)}</div>
              <p className="judge-safe-note">Retry is safe. No payment or chain write occurred.</p>
            </section>
          ) : result ? (
            <JudgeDecision result={result} resultRef={resultRef} sharePassport={sharePassport} shareStatus={shareStatus} />
          ) : (
            <section className="judge-empty" aria-label="No PassportGate result yet">
              <span aria-hidden="true">LP</span>
              <h2>Ready for proof</h2>
              <p>Choose the backend-provided healthy fixture and run one independent, read-only Passport check.</p>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

function JudgeLoading() {
  return <section className="judge-loading" role="status"><span className="judge-spinner" aria-hidden="true" /><p className="eyebrow">Reconstructing proof</p><h2>Checking chain, receipts, and evidence…</h2><p>This does not perform a rehearsal or spend funds.</p></section>;
}

function JudgeDecision({
  result,
  resultRef,
  sharePassport,
  shareStatus,
}: {
  result: PassportGateDecisionResult;
  resultRef: React.RefObject<HTMLElement | null>;
  sharePassport: (result: PassportGateDecisionResult) => Promise<void>;
  shareStatus: string | null;
}) {
  const gates = result.gates ?? {
    discoverable: false,
    contract_correct: false,
    fresh_challenge: false,
    safe_to_rehearse: false,
    paid_delivery: false,
  };
  const noGateEvidence = result.gates === null;
  return (
    <section className={`judge-result judge-result-${result.decision.toLowerCase().replace("_", "-")}`} ref={resultRef} tabIndex={-1}>
      <div className="judge-decision-head">
        <div><p className="eyebrow">PassportGate decision</p><h2>{result.decision === "REHEARSAL_REQUIRED" ? "REHEARSAL REQUIRED" : result.decision}</h2><p>{result.explanation}</p></div>
        <FreshnessBadge result={result} />
      </div>

      <div className="judge-verification-line">
        <span className={result.independent_verification ? "verification-yes" : "verification-no"}>
          {result.independent_verification ? "✓ Independently verified proof" : "× Independent verification not established"}
        </span>
        <span>{result.status ?? "No current Passport"}</span>
      </div>

      <section className="judge-evidence-section" aria-labelledby="judge-gates-title">
        <div className="judge-section-title"><h3 id="judge-gates-title">Five rehearsal gates</h3><small>{noGateEvidence ? "No matching verified Passport" : "On-chain Passport evidence"}</small></div>
        <div className="judge-gates">
          {Object.entries(gateLabels).map(([gate, label]) => {
            const passed = gates[gate as keyof typeof gates];
            return <div className={noGateEvidence ? "judge-gate judge-gate-empty" : passed ? "judge-gate judge-gate-pass" : "judge-gate judge-gate-fail"} key={gate}><span aria-hidden="true">{noGateEvidence ? "—" : passed ? "✓" : "×"}</span><strong>{label}</strong><small>{noGateEvidence ? "not available" : passed ? "passed" : "failed"}</small></div>;
          })}
        </div>
      </section>

      <section className="judge-evidence-section" aria-labelledby="judge-transactions-title">
        <div className="judge-section-title"><h3 id="judge-transactions-title">Settlement and publication</h3><small>Real X Layer Testnet references only</small></div>
        <div className="judge-transactions">
          <TransactionCard label="LaunchProof settlement" link={result.explorer_links.inboundSettlement} settlement={result.inbound_settlement} />
          <TransactionCard label="Provider settlement" link={result.explorer_links.providerSettlement} settlement={result.provider_settlement} />
          <TransactionCard label="Evidence publication" link={result.explorer_links.publicationTransaction} transactionHash={result.evidence_publication_transaction} />
        </div>
      </section>

      <div className="judge-actions">
        {result.passport_url ? <button className="secondary" onClick={() => void sharePassport(result)} type="button">Copy / share Passport</button> : null}
        {result.rehearsal_action ? <a className="judge-action-link" href={result.rehearsal_action.url}>{result.rehearsal_action.kind === "RENEW" ? "Renew Passport" : "Rehearse service"} →</a> : null}
        {shareStatus ? <span className="judge-share-status" role="status">{shareStatus}</span> : null}
      </div>

      <details className="judge-technical">
        <summary>Technical evidence</summary>
        <dl>
          <EvidenceValue label="Run ID" value={result.run_id} />
          <EvidenceValue label="Provider" value={result.provider_address} />
          <EvidenceValue label="Source revision" value={result.source_revision} />
          <EvidenceValue label="Evidence hash" value={result.evidence_hash} />
          <EvidenceValue label="Manifest hash" value={result.manifest_hash} />
          <EvidenceValue label="Input hash" value={result.input_hash} />
          <EvidenceValue label="Result hash" value={result.result_hash} />
          <EvidenceValue label="Database / chain agreement" value={result.database_chain_match === null ? null : result.database_chain_match ? "match" : "mismatch"} />
        </dl>
        <pre>{JSON.stringify({
          contract_identity: result.contract_identity,
          inbound_settlement: result.inbound_settlement,
          provider_settlement: result.provider_settlement,
          evidence_publication_transaction: result.evidence_publication_transaction,
        }, null, 2)}</pre>
        <div className="judge-reasons" aria-label="Decision reasons">{result.reason_codes.map((reason) => <code key={reason}>{humanize(reason)}</code>)}</div>
      </details>
    </section>
  );
}

function FreshnessBadge({ result }: { result: PassportGateDecisionResult }) {
  const age = result.passport_age_hours;
  if (age === null) return <span className="freshness freshness-none">No matching Passport</span>;
  const className = age <= result.warn_age_hours ? "freshness freshness-fresh" : age <= result.max_age_hours ? "freshness freshness-warn" : "freshness freshness-expired";
  const label = age <= result.warn_age_hours ? "Fresh" : age <= result.max_age_hours ? "Age warning" : "Expired";
  return <span className={className}>{label} · {formatAge(age)}</span>;
}

function TransactionCard({ label, settlement, transactionHash, link }: { label: string; settlement?: PassportGateSettlement | null; transactionHash?: string | null; link: string | null }) {
  const hash = settlement?.transactionHash ?? transactionHash ?? null;
  return <article className="judge-transaction"><small>{label}</small><strong>{hash ? shortHash(hash) : "Not verified"}</strong>{settlement ? <span>{settlement.amountAtomic} atomic units · {settlement.network}</span> : <span>{hash ? "Published on X Layer Testnet" : "No independently verified transaction"}</span>}{hash && link ? <a href={link} rel="noreferrer" target="_blank" aria-label={`${label} transaction on configured X Layer Testnet explorer`}>View transaction ↗</a> : null}</article>;
}

function EvidenceValue({ label, value }: { label: string; value: string | null }) {
  return <div><dt>{label}</dt><dd><code>{value ?? "not available"}</code></dd></div>;
}

function formatAge(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m old`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h old`;
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function isUserRejection(value: unknown) {
  return typeof value === "object" && value !== null && "name" in value && (value.name === "AbortError" || value.name === "NotAllowedError");
}
