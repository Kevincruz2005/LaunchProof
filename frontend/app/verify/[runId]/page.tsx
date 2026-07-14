import { VerifyClient } from "../../../components/verify-client";
export default async function VerifyPage({ params }: { params: Promise<{ runId: string }> }) { const { runId } = await params; return <VerifyClient runId={runId} />; }
