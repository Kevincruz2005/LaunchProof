import Link from "next/link";
import { Disclaimers } from "../components/brand";
import { RecentPassports } from "../components/recent-passports";
import { WalletControl } from "../components/wallet-control";

export default function Home() {
  return (
    <main>
      <section className="home-hero">
        <div className="hero-copy"><p className="eyebrow">PassportGate · X Layer Testnet</p><h1>Before an agent hires an ASP,<br /><em>ask for proof.</em></h1><p className="lede">LaunchProof returns ALLOW, WARN, BLOCK, or REHEARSAL REQUIRED from a real paid rehearsal and independently verified on-chain Service Passport—not a rating or simulated transaction.</p><div className="proof-strip"><span><strong>5</strong> explainable gates</span><span><strong>2</strong> settlement receipts</span><span><strong>1×</strong> on-chain Passport</span></div><div className="hero-action"><Link className="secondary" href="/judge">Open Judge Mode →</Link></div></div>
        <WalletControl placement="home" />
      </section>
      <RecentPassports />
      <section className="process-section"><div className="section-heading"><div><p className="eyebrow">One bounded run</p><h2>Promise → rehearsal → Passport</h2></div><Link className="text-link" href="/docs/quick-verify">Review the verification path →</Link></div><div className="process-grid"><article><span>01</span><h3>Read the contract</h3><p>Fetch the provider-declared public manifest with DNS and redirect protections, then report its signature state.</p></article><article><span>02</span><h3>Try the hard edges</h3><p>Discover the tool, run the sample, reject invalid input, and generate fresh invoices.</p></article><article><span>03</span><h3>Publish when confirmed</h3><p>Record normalized evidence, then attach publication state and a transaction only when the registry confirms it.</p></article></div></section>
      <section className="passport-preview"><div><p className="eyebrow">Illustrative layout · not a run result</p><h2>Agent-readable result.<br />Buyer-readable evidence.</h2><p>No hidden score. Every completed run reports each named gate, payment status, provenance, and registry publication independently.</p><Link className="secondary" href="/fixtures">Explore controlled fixtures</Link></div><div className="preview-card"><div className="preview-head"><span className="status status-not-rehearsable">illustration</span><code>A real run ID appears after rehearsal</code></div>{["Discoverable", "Contract correct", "Fresh challenge", "Safe to rehearse", "Paid delivery"].map((gate) => <div className="preview-gate preview-gate-neutral" key={gate}><span>—</span><strong>{gate}</strong><small>measured at runtime</small></div>)}<div className="chain-line"><span className="dot-muted">Not a publication</span><code>A transaction link appears only after confirmation</code></div></div></section>
      <Disclaimers />
    </main>
  );
}
