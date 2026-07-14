"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/generated-api/client";
import { CopyValue } from "./copy-value";

interface Receipt {
  payment_id: string;
  kind: "launchproof" | "target";
  run_id: string;
  amount: string;
  asset: string;
  network: string;
  payer: string | null;
  recipient: string | null;
  route: string;
  settlement_transaction: string | null;
  status: "settled" | "not_tested" | "local_only";
  timestamp: string;
  source_commit: string;
  explorer_url: string | null;
  run_url: string;
  chain_run_linkage_matches: boolean;
}

export function ReceiptView({ paymentId }: { paymentId: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiGet<Receipt>(`/receipts/${encodeURIComponent(paymentId)}`).then(setReceipt).catch((cause) => setError(cause instanceof Error ? cause.message : "Receipt request failed"));
  }, [paymentId]);

  return (
    <main className="page receipt-page">
      <section className="page-title"><p className="eyebrow">Settlement and run linkage</p><h1>Payment receipt</h1><p>A public receipt is a reference to observed settlement evidence, not an invoice or custody record.</p></section>
      {error ? <p className="error">{error}</p> : null}
      {!receipt ? <div className="loading">Reading settlement evidence...</div> : (
        <section className="panel receipt-card">
          <header className="receipt-head">
            <div><span className={`receipt-status receipt-${receipt.status}`}>{receipt.status.replaceAll("_", " ")}</span><h2>{receipt.amount} {assetName(receipt.asset)}</h2><p>{formatDate(receipt.timestamp)} · {receipt.network}</p></div>
            <div className={receipt.chain_run_linkage_matches ? "linkage linkage-pass" : "linkage linkage-muted"}>{receipt.chain_run_linkage_matches ? "Linked to run" : "No settled chain link"}</div>
          </header>
          <div className="two-column receipt-columns">
            <div>
              <CopyValue label="Payment ID" value={receipt.payment_id} />
              <CopyValue label="Run ID" value={receipt.run_id} />
              <CopyValue label="Payer" value={receipt.payer ?? "not available"} />
            </div>
            <div>
              <CopyValue label="Recipient" value={receipt.recipient ?? "not available"} />
              <CopyValue label="Asset contract" value={receipt.asset} />
              <CopyValue label="Settlement transaction" value={receipt.settlement_transaction ?? "not available"} />
              <CopyValue label="Source commit" value={receipt.source_commit} />
            </div>
          </div>
          <dl className="detail-list receipt-details"><div><dt>Payment kind</dt><dd>{receipt.kind}</dd></div><div><dt>Protected route</dt><dd><code>{receipt.route}</code></dd></div></dl>
          <div className="button-row">
            <Link className="primary receipt-primary" href={`/passport/${encodeURIComponent(receipt.run_id)}`}>Open service passport</Link>
            {receipt.explorer_url ? <a className="secondary" href={receipt.explorer_url} rel="noreferrer" target="_blank">View on OKLink</a> : null}
          </div>
        </section>
      )}
    </main>
  );
}

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "medium" }).format(new Date(value)); }
function assetName(value: string) { return value.toLowerCase() === "0x779ded0c9e1022225f8e0630b35a9b54be713736" ? "USDT0" : value; }
