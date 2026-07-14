"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/generated-api/client";

interface Fixture {
  variant: string;
  label: "fixture";
  launch_contract: string | null;
  health: string | null;
  source: string;
  declaration_address: string | null;
  intended_outcome: string;
}

export function FixtureCatalog() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiGet<{ fixtures: Fixture[] }>("/fixtures").then((value) => setFixtures(value.fixtures)).catch((cause) => setError(cause instanceof Error ? cause.message : "Fixture request failed"));
  }, []);

  return (
    <main className="page">
      <section className="page-title"><p className="eyebrow">Passing and classified failure cases</p><h1>Controlled public fixtures</h1><p>Known targets make the verification path repeatable without presenting synthetic evidence as a production agent.</p></section>
      {error ? <p className="error">{error}</p> : null}
      {!fixtures ? <div className="loading">Reading fixture catalog...</div> : (
        <section className="fixture-grid">
          {fixtures.map((fixture) => (
            <article className="panel fixture-card" key={fixture.variant}>
              <div className="fixture-head"><span className={`fixture-mark fixture-${fixture.variant === "healthy" ? "pass" : "fail"}`}>{fixture.variant === "healthy" ? "OK" : "FAIL"}</span><small>Controlled fixture</small></div>
              <h2>{fixture.variant.replaceAll("-", " ")}</h2>
              <p>{fixture.intended_outcome}</p>
              <dl className="detail-list fixture-details"><div><dt>Declaration</dt><dd><code>{fixture.declaration_address ?? "not deployed"}</code></dd></div></dl>
              <div className="fixture-links">
                {fixture.launch_contract ? <a className="secondary" href={fixture.launch_contract} rel="noreferrer" target="_blank">Launch contract</a> : <span className="deployment-note">Public HTTPS deployment not configured</span>}
                {fixture.health ? <a className="text-link" href={fixture.health} rel="noreferrer" target="_blank">Health</a> : null}
                <a className="text-link" href={fixture.source} rel="noreferrer" target="_blank">Source revision</a>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
