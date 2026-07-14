import { ReceiptView } from "../../../components/receipt-view";
export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) { const { paymentId } = await params; return <ReceiptView paymentId={paymentId} />; }
