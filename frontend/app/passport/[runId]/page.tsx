import { PassportLoader } from "./passport-loader";
export const metadata = { title: "Service Passport" };
export default async function PassportPage({ params }: { params: Promise<{ runId: string }> }) { const { runId } = await params; return <main className="page"><PassportLoader runId={runId} /></main>; }
