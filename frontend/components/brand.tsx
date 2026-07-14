import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="LaunchProof home">
      <span className="brand-mark" aria-hidden="true">LP</span>
      <span>LaunchProof</span>
    </Link>
  );
}

export function Disclaimers() {
  return (
    <aside className="disclaimers" aria-label="Important limitations">
      <strong>Point-in-time operational evidence</strong>
      <ul>
        <li>LaunchProof is not a security certification.</li>
        <li>A passport is not a guarantee of future uptime or behavior.</li>
        <li>It is not OKX marketplace identity verification and is not issued or endorsed by OKX.</li>
      </ul>
    </aside>
  );
}
