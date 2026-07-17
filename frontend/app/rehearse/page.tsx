import { RehearsalForm } from "../../components/rehearsal-form";

export const metadata = { title: "Rehearse a service" };
export default function RehearsePage() { return <main className="page"><section className="page-title"><p className="eyebrow">Explicit authorization and provenance</p><h1>Rehearse a Launch Contract</h1><p>Choose a real x402 payment when enabled, or an explicitly labeled development-only unpaid run. Each rehearsal makes one fixed call, one controlled invalid call, exactly three fresh challenges, and no automatic target retry.</p></section><RehearsalForm expanded /></main>; }
