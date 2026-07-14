"use client";

import { useState } from "react";

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="copy-row">
      <div><small>{label}</small><code title={value}>{value}</code></div>
      <button className="copy-button" onClick={copy} type="button">{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
