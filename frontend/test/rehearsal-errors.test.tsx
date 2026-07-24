// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectCard } from "../lib/generated-api/client";

const mocks = vi.hoisted(() => ({
  connectWallet: vi.fn(),
  getProjectCard: vi.fn(),
  restoreConnectedWallet: vi.fn(),
  submitRun: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.routerPush }) }));
vi.mock("../lib/generated-api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/generated-api/client")>();
  return {
    ...original,
    clearPendingRun: vi.fn(),
    connectWallet: mocks.connectWallet,
    forgetConnectedWallet: vi.fn(),
    getProjectCard: mocks.getProjectCard,
    loadPendingRun: vi.fn().mockReturnValue(null),
    rememberConnectedWallet: vi.fn(),
    restoreConnectedWallet: mocks.restoreConnectedWallet,
    savePendingRun: vi.fn(),
    subscribeToInjectedWallet: vi.fn().mockReturnValue(() => undefined),
    submitRun: mocks.submitRun,
  };
});

import { RehearsalForm } from "../components/rehearsal-form";
import { WalletControl } from "../components/wallet-control";

function projectCard(): ProjectCard {
  const asset = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c" as const;
  return {
    name: "LaunchProof",
    build_commit: "a".repeat(40),
    source_commit: "a".repeat(40),
    chain: {
      id: 1952,
      network: "eip155:1952",
      name: "X Layer Testnet",
      testnet: true,
      rpc_url: "https://rpc.example.test",
      explorer_url: "https://explorer.example.test",
      registry_address: `0x${"22".repeat(20)}`,
      registry_deployment_block: "123",
      registry_runtime_code_hash: `0x${"33".repeat(32)}`,
      usdt0_address: asset,
      usdt0_decimals: 6,
    },
    payments: {
      x402_enabled: true,
      payment_ready: true,
      local_unpaid_enabled: false,
      asset: { symbol: "USD₮0", address: asset, decimals: 6 },
      pay_to: `0x${"11".repeat(20)}`,
      genesis_amount: "0.01",
      genesis_amount_atomic: "10000",
      renewal_amount: "0.10",
      renewal_amount_atomic: "100000",
    },
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_PAYOUT_ADDRESS = `0x${"11".repeat(20)}`;
  mocks.getProjectCard.mockResolvedValue(projectCard());
  mocks.restoreConnectedWallet.mockResolvedValue(`0x${"55".repeat(20)}`);
});

afterEach(() => {
  cleanup();
  mocks.connectWallet.mockReset();
  mocks.submitRun.mockReset();
  mocks.routerPush.mockReset();
  mocks.getProjectCard.mockReset();
  mocks.restoreConnectedWallet.mockReset();
  delete process.env.NEXT_PUBLIC_PAYOUT_ADDRESS;
});

describe("existing wallet and paid rehearsal failures", () => {
  it("shows wallet rejection without claiming a connection", async () => {
    mocks.connectWallet.mockRejectedValue(Object.assign(new Error("User rejected the wallet connection"), { code: 4001 }));
    const user = userEvent.setup();
    render(<WalletControl placement="header" />);
    const connect = await screen.findByRole("button", { name: "Connect wallet" });
    await waitFor(() => expect(connect).toBeEnabled());
    await user.click(connect);
    expect(await screen.findByRole("alert")).toHaveTextContent("User rejected the wallet connection");
    expect(screen.queryByText(/0x55/)).not.toBeInTheDocument();
  });

  it("keeps the rehearsal on its failure state when the user rejects payment", async () => {
    mocks.submitRun.mockRejectedValue(Object.assign(new Error("User rejected the x402 payment signature"), { code: 4001 }));
    const user = userEvent.setup();
    render(<RehearsalForm expanded />);
    const url = await screen.findByLabelText("Provider domain or Launch Contract URL");
    await user.type(url, "https://provider.example.test");
    const submit = screen.getByRole("button", { name: /Approve payment and rehearse/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("User rejected the x402 payment signature");
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });
});
