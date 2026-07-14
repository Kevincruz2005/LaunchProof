import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "../components/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LaunchProof — rehearse before buyers pay", template: "%s · LaunchProof" },
  description: "A bounded paid MCP rehearsal and chain-backed Service Passport for agent services.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_BASE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "LaunchProof — a listing is a promise. Rehearse it.",
    description: "Five explainable gates and durable X Layer evidence for paid agent services.",
    type: "website",
    images: [{ url: "/og.png", width: 1733, height: 909, alt: "LaunchProof Service Passport with five explainable gates" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LaunchProof — rehearse before buyers pay",
    description: "Five explainable gates and durable X Layer evidence.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const source = process.env.NEXT_PUBLIC_SOURCE_REPOSITORY;
  return (
    <html lang="en">
      <body>
        <header className="site-header"><Brand /><nav aria-label="Primary"><Link href="/fixtures">Fixtures</Link><Link href="/status">Status</Link><Link href="/docs/quick-verify">Quick verify</Link><Link className="nav-cta" href="/rehearse">Rehearse a service</Link></nav></header>
        {children}
        <footer><Brand /><p>On-chain-settled. Off-chain rehearsed. Independently verifiable.</p><div><Link href="/status">Status</Link><Link href="/fixtures">Fixtures</Link>{source ? <a href={source}>Source</a> : <span>Source not configured</span>}</div></footer>
      </body>
    </html>
  );
}
