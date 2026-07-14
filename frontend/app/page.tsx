import Link from "next/link";
import { RehearsalForm } from "../components/rehearsal-form";
import { Disclaimers } from "../components/brand";
import { RecentPassports } from "../components/recent-passports";

export default function Home() {
  return (
    <main>
      <section className="home-hero">
        <div className="hero-copy"><p className="eyebrow">Service rehearsal · X Layer mainnet</p><h1>A listing is a promise.<br /><em>Rehearse it.</em></h1><p className="lede">LaunchProof runs a provider-signed sample, a safe failure, and three fresh challenges—then publishes the retained evidence on X Layer before buyers pay for the real job.</p><div className="proof-strip"><span><strong>5</strong> explainable gates</span><span><strong>3</strong> fresh challenges</span><span><strong>1×</strong> no-retry execution</span></div></div>
        <RehearsalForm />
      </section>
      <RecentPassports />
      <section className="process-section"><div className="section-heading"><div><p className="eyebrow">One bounded run</p><h2>Promise → rehearsal → Passport</h2></div><Link className="text-link" href="/docs/quick-verify">Review in under two minutes →</Link></div><div className="process-grid"><article><span>01</span><h3>Read the contract</h3><p>Fetch the signed public manifest with DNS and redirect protections.</p></article><article><span>02</span><h3>Try the hard edges</h3><p>Discover the tool, run the sample, reject invalid input, and generate fresh invoices.</p></article><article><span>03</span><h3>Anchor the evidence</h3><p>Publish normalized evidence, hashes, payment linkage, gates, and source revision.</p></article></div></section>
      <section className="passport-preview"><div><p className="eyebrow">Same canonical run, two readers</p><h2>Agent-readable result.<br />Buyer-readable proof.</h2><p>No hidden score. Every verdict is one of five named gates, with the exact structured comparison behind it.</p><Link className="secondary" href="/fixtures">Explore controlled fixtures</Link></div><div className="preview-card"><div className="preview-head"><span className="status status-verified">✓ verified</span><code>Run ID appears after rehearsal</code></div>{["Discoverable", "Contract correct", "Fresh challenge", "Safe to rehearse", "Paid delivery"].map((gate) => <div className="preview-gate" key={gate}><span>✓</span><strong>{gate}</strong><small>pass</small></div>)}<div className="chain-line"><span className="dot-live">On chain</span><code>Evidence transaction after anchoring</code></div></div></section>
      <Disclaimers />
    </main>
  );
}
