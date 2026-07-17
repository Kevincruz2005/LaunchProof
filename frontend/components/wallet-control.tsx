"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  connectWallet,
  forgetConnectedWallet,
  getProjectCard,
  rememberConnectedWallet,
  restoreConnectedWallet,
  subscribeToInjectedWallet,
  type ProjectCard,
} from "../lib/generated-api/client";

export function WalletControl({ placement }: { placement: "header" | "home" }) {
  const [card, setCard] = useState<ProjectCard | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;
    void getProjectCard()
      .then(async (projectCard) => {
        if (cancelled) return;
        setCard(projectCard);
        setAccount(await restoreConnectedWallet(projectCard));
        unsubscribe = subscribeToInjectedWallet(() => {
          void restoreConnectedWallet(projectCard).then((restored) => {
            if (!cancelled) setAccount(restored);
          });
        });
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Wallet configuration is unavailable.");
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function connect() {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      if (account) {
        await forgetConnectedWallet();
        setAccount(null);
      }
      // Always request fresh account permission. Clicking this control must
      // open the wallet connection/account-selection flow, even if an account
      // is already active in this tab.
      const nextAccount = await connectWallet(card, true);
      rememberConnectedWallet(nextAccount);
      setAccount(nextAccount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    await forgetConnectedWallet();
    setAccount(null);
    setBusy(false);
  }

  if (placement === "header") {
    return (
      <div className="nav-wallet">
        {account ? <span title={account}>{shortAddress(account)}</span> : null}
        <button disabled={busy || !card} onClick={() => void connect()} type="button">
          {busy ? "Opening wallet…" : "Connect wallet"}
        </button>
      </div>
    );
  }

  return (
    <div className="home-wallet-card">
      <p className="eyebrow">Start with your testnet wallet</p>
      <h2>{account ? "Wallet connected" : "Connect to LaunchProof"}</h2>
      <p>{account ? `Connected for this tab as ${shortAddress(account)}.` : "Approve the connection in OKX Wallet, then continue to the rehearsal page when you are ready."}</p>
      <button className="home-wallet-button" disabled={busy || !card} onClick={() => void connect()} type="button">
        {busy ? "Opening OKX Wallet…" : "Connect wallet"}
      </button>
      {account ? <button className="home-wallet-disconnect" disabled={busy} onClick={() => void disconnect()} type="button">Disconnect</button> : null}
      {error ? <p className="wallet-control-error" role="alert">{error}</p> : null}
      <Link className="text-link" href="/rehearse">Continue to rehearse a service →</Link>
    </div>
  );
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
