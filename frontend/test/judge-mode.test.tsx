// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run as runAxe } from "axe-core";
import { JudgeMode } from "../components/judge-mode";
import type {
  ControlledFixture,
  PassportGateDecision,
  PassportGateDecisionResult,
  PassportGateResult,
} from "../lib/generated-api/client";

const dynamicHealthyUrl = "https://catalog-controlled.example.test/.well-known/launch-contract.json";
const fixtureCatalog: ControlledFixture[] = [{
  variant: "healthy",
  label: "fixture",
  launch_contract: dynamicHealthyUrl,
  health: "https://catalog-controlled.example.test/healthz",
  source: "https://source.example.test/tree/a/fixture",
  declaration_address: `0x${"11".repeat(20)}`,
  intended_outcome: "All gates pass, including paid delivery",
}];

const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const address = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;

function decision(value: PassportGateDecision = "ALLOW"): PassportGateDecisionResult {
  const hasPassport = value !== "REHEARSAL_REQUIRED";
  return {
    operational_status: "AVAILABLE",
    decision: value,
    reason_codes: [value === "ALLOW" ? "PASSPORT_VALID" : value === "WARN" ? "PASSPORT_APPROACHING_EXPIRY" : value === "BLOCK" ? "GATE_PAID_DELIVERY_FAILED" : "PASSPORT_NOT_FOUND"],
    explanation: `${value} from independently reconstructed evidence.`,
    observed_at: "2026-07-20T12:00:00.000Z",
    passport_age_hours: hasPassport ? (value === "WARN" ? 30 : 2) : null,
    warn_age_hours: 24,
    max_age_hours: 72,
    expires_at: hasPassport ? "2026-07-23T10:00:00.000Z" : null,
    contract_identity: hasPassport ? {
      launchContractUrl: dynamicHealthyUrl,
      manifestHash: hash("1"),
      providerAddress: address("2"),
      sourceRevision: "a".repeat(40),
      identityHash: hash("3"),
    } : null,
    provider_address: hasPassport ? address("2") : null,
    source_revision: hasPassport ? "a".repeat(40) : null,
    run_id: hasPassport ? hash("4") : null,
    passport_url: hasPassport ? "https://web.example.test/passport/verified-run" : null,
    status: hasPassport ? value === "BLOCK" ? "NeedsAttention" : "Verified" : null,
    gates: hasPassport ? {
      discoverable: true,
      contract_correct: true,
      fresh_challenge: true,
      safe_to_rehearse: true,
      paid_delivery: value !== "BLOCK",
    } : null,
    independent_verification: hasPassport && value !== "BLOCK",
    database_chain_match: hasPassport,
    inbound_settlement: hasPassport ? {
      paymentId: "launchproof-payment",
      network: "eip155:1952",
      asset: address("5"),
      amountAtomic: "10000",
      assetDecimals: 6,
      payer: address("6"),
      recipient: address("7"),
      transactionHash: hash("8"),
      blockTimestamp: "2026-07-20T10:00:00.000Z",
    } : null,
    provider_settlement: hasPassport ? {
      paymentId: "provider-payment",
      network: "eip155:1952",
      asset: address("5"),
      amountAtomic: "5000",
      assetDecimals: 6,
      payer: address("7"),
      recipient: address("2"),
      transactionHash: hash("9"),
      blockTimestamp: "2026-07-20T10:01:00.000Z",
    } : null,
    evidence_publication_transaction: hasPassport ? hash("a") : null,
    explorer_links: {
      publicationTransaction: hasPassport ? "https://explorer.example.test/tx/publication" : null,
      inboundSettlement: hasPassport ? "https://explorer.example.test/tx/inbound" : null,
      providerSettlement: hasPassport ? "https://explorer.example.test/tx/provider" : null,
    },
    evidence_hash: hasPassport ? hash("b") : null,
    manifest_hash: hasPassport ? hash("1") : null,
    input_hash: hasPassport ? hash("c") : null,
    result_hash: hasPassport ? hash("d") : null,
    rehearsal_action: value === "REHEARSAL_REQUIRED" ? {
      kind: "REHEARSE",
      url: "https://web.example.test/rehearse?url=controlled",
      requiresExplicitPaymentApproval: true,
      automaticallyExecuted: false,
    } : value === "WARN" ? {
      kind: "RENEW",
      url: "https://web.example.test/rehearse?renew=verified-run",
      requiresExplicitPaymentApproval: true,
      automaticallyExecuted: false,
    } : null,
  };
}

function renderJudge(result: PassportGateResult = decision()) {
  const loadFixtures = vi.fn().mockResolvedValue(fixtureCatalog);
  const checkPassport = vi.fn().mockResolvedValue(result);
  render(<JudgeMode loadFixtures={loadFixtures} checkPassport={checkPassport} />);
  return { loadFixtures, checkPassport };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Judge Mode", () => {
  it("loads and prefills the healthy fixture from the backend catalog, then renders the complete ALLOW proof", async () => {
    const user = userEvent.setup();
    const { loadFixtures, checkPassport } = renderJudge();

    expect(await screen.findByDisplayValue(/healthy · All gates pass/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Launch Contract URL")).toHaveValue(dynamicHealthyUrl);
    expect(loadFixtures).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Check Service Passport" }));
    expect(checkPassport).toHaveBeenCalledWith(dynamicHealthyUrl);
    expect(await screen.findByRole("heading", { name: "ALLOW" })).toBeInTheDocument();
    expect(screen.getByText("Fresh · 2.0h old")).toBeInTheDocument();
    expect(screen.getByText("✓ Independently verified proof")).toBeInTheDocument();
    expect(screen.getAllByText("passed")).toHaveLength(5);
    expect(screen.getByText("LaunchProof settlement")).toBeInTheDocument();
    expect(screen.getByText("Provider settlement")).toBeInTheDocument();
    expect(screen.getByText("Evidence publication")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /configured X Layer Testnet explorer/ })).toHaveLength(3);
    expect(screen.getByText("Technical evidence")).toBeInTheDocument();
  });

  it.each<[PassportGateDecision, string]>([
    ["ALLOW", "Fresh"],
    ["WARN", "Age warning"],
    ["BLOCK", "Independent verification not established"],
    ["REHEARSAL_REQUIRED", "No matching Passport"],
  ])("renders the %s decision without converting missing evidence into proof", async (value, expected) => {
    const user = userEvent.setup();
    renderJudge(decision(value));
    await screen.findByLabelText("Launch Contract URL");
    await user.click(screen.getByRole("button", { name: "Check Service Passport" }));
    expect(await screen.findByRole("heading", { name: value.replace("_", " ") })).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(expected, "i")).length).toBeGreaterThan(0);
    if (value === "REHEARSAL_REQUIRED") {
      expect(within(screen.getByRole("region", { name: "Five rehearsal gates" })).getAllByText("not available")).toHaveLength(5);
      expect(screen.getByRole("link", { name: /Rehearse service/ })).toHaveAttribute("href", "https://web.example.test/rehearse?url=controlled");
      expect(screen.queryByRole("button", { name: /share Passport/ })).not.toBeInTheDocument();
    }
  });

  it("renders HTTP 503 as retry-safe unavailability with no decision", async () => {
    const user = userEvent.setup();
    renderJudge({
      error: "verification_unavailable",
      retry_safe: true,
      operational_status: "UNAVAILABLE",
      decision: null,
      reason_codes: ["RPC_TIMEOUT"],
      explanation: "The configured X Layer RPC timed out.",
      observed_at: "2026-07-20T12:00:00.000Z",
    });
    await screen.findByLabelText("Launch Contract URL");
    await user.click(screen.getByRole("button", { name: "Check Service Passport" }));
    expect(await screen.findByRole("heading", { name: "No trust decision" })).toBeInTheDocument();
    expect(screen.getByText(/Retry is safe/)).toBeInTheDocument();
    expect(screen.queryByText("BLOCK")).not.toBeInTheDocument();
  });

  it("shows catalog-empty and request-failure states without inventing a fixture or decision", async () => {
    render(<JudgeMode loadFixtures={vi.fn().mockResolvedValue([])} checkPassport={vi.fn()} />);
    expect(await screen.findByText("No healthy controlled fixture is configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check Service Passport" })).toBeDisabled();
    cleanup();

    const user = userEvent.setup();
    render(<JudgeMode loadFixtures={vi.fn().mockResolvedValue(fixtureCatalog)} checkPassport={vi.fn().mockRejectedValue(new Error("Malformed verification response"))} />);
    await screen.findByLabelText("Launch Contract URL");
    await user.click(screen.getByRole("button", { name: "Check Service Passport" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No decision made");
    expect(screen.getByRole("alert")).toHaveTextContent("Malformed verification response");
  });

  it("supports keyboard activation, moves focus to the result, and has no detectable axe violations", async () => {
    const user = userEvent.setup();
    renderJudge();
    await screen.findByLabelText("Launch Contract URL");
    const button = screen.getByRole("button", { name: "Check Service Passport" });
    button.focus();
    await user.keyboard("{Enter}");
    const heading = await screen.findByRole("heading", { name: "ALLOW" });
    expect(heading.closest("section")).toHaveFocus();
    const accessibility = await runAxe(document.body, { rules: { region: { enabled: false }, "color-contrast": { enabled: false } } });
    expect(accessibility.violations).toEqual([]);
  });

  it("preserves every decision and evidence control at a mobile viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    window.dispatchEvent(new Event("resize"));
    const user = userEvent.setup();
    renderJudge(decision("WARN"));
    await screen.findByLabelText("Launch Contract URL");
    await user.click(screen.getByRole("button", { name: "Check Service Passport" }));
    expect(await screen.findByRole("heading", { name: "WARN" })).toBeInTheDocument();
    expect(screen.getAllByText(/settlement|publication/i).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: "Copy / share Passport" })).toBeVisible();
    expect(screen.getByText("Technical evidence")).toBeVisible();
    expect(within(screen.getByLabelText("PassportGate service check")).getAllByRole("link", { name: /configured X Layer Testnet explorer/ })).toHaveLength(3);
  });
});
