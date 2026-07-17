import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "../components/brand";
import { WalletControl } from "../components/wallet-control";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LaunchProof — rehearse before buyers pay", template: "%s · LaunchProof" },
  description: "A bounded MCP rehearsal with explicit payment state and chain-backed Service Passport evidence.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_BASE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "LaunchProof — a listing is a promise. Rehearse it.",
    description: "Five explainable gates with explicit payment and X Layer publication evidence.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "LaunchProof — rehearse before buyers pay",
    description: "Five explainable gates with explicit payment and publication evidence.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const source = process.env.NEXT_PUBLIC_SOURCE_REPOSITORY;
  return (
    <html lang="en">
      <body>
        <header className="site-header"><Brand /><nav aria-label="Primary"><Link href="/fixtures">Fixtures</Link><Link href="/status">Status</Link><Link href="/docs/quick-verify">Quick verify</Link><WalletControl placement="header" /><Link className="nav-cta" href="/rehearse">Rehearse a service</Link></nav></header>
        {children}
        <footer><Brand /><p>Off-chain rehearsed. Payment and chain publication reported separately. Publicly cross-checkable.</p><div><Link href="/status">Status</Link><Link href="/fixtures">Fixtures</Link>{source ? <a href={source}>Source</a> : <span>Source not configured</span>}</div></footer>
      </body>
    </html>
  );
}
