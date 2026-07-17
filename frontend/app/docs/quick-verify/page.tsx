export const metadata = { title: "Quick verify" };

export default function QuickVerifyPage() {
  return (
    <main className="page">
      <section className="page-title"><p className="eyebrow">Verify each claim separately</p><h1>Verify the evidence, not the pitch</h1></section>
      <ol className="verify-steps">
        <li><span>1</span><div><h2>Confirm authorization mode</h2><p>Before submitting, check the public project card. Paid mode must be enabled and must show the expected chain, token, atomic price, and recipient. Local mode is unpaid development evidence.</p></div></li>
        <li><span>2</span><div><h2>Inspect the observed gates</h2><p>Use a controlled fixture only when it is explicitly labeled <code>fixture</code>. Confirm the actual comparisons and classifications instead of relying on the overall badge.</p></div></li>
        <li><span>3</span><div><h2>Verify settlement independently of publication</h2><p>A paid receipt must say <code>settled</code> and include a settlement transaction. Registry publication is a separate transaction and does not prove payment by itself.</p></div></li>
        <li><span>4</span><div><h2>Cross-check registry storage</h2><p>Open the Passport and Verify pages. Compare the recorded hashes through the configured public RPC, and follow only the transaction links that are actually present.</p></div></li>
      </ol>
    </main>
  );
}
