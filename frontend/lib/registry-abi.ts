// Minimal, source-controlled interface used by the browser's direct registry read.
// Keeping it in the frontend avoids treating an ABI downloaded from the API being
// verified as an independent contract definition.
export const registryReadAbi = [
  {
    type: "function",
    name: "getRun",
    stateMutability: "view",
    inputs: [{ name: "runId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "evidenceHash", type: "bytes32" },
          { name: "manifestHash", type: "bytes32" },
          { name: "inputHash", type: "bytes32" },
          { name: "normalizedResultHash", type: "bytes32" },
          { name: "sourceRevisionHash", type: "bytes32" },
          { name: "paymentReceiptHash", type: "bytes32" },
          { name: "previousRunId", type: "bytes32" },
          { name: "provider", type: "address" },
          { name: "anchoredBy", type: "address" },
          { name: "anchoredAt", type: "uint40" },
          { name: "gateBitmap", type: "uint16" },
          { name: "status", type: "uint8" },
          { name: "providerSignatureVerified", type: "bool" },
          { name: "isFixture", type: "bool" },
        ],
      },
    ],
  },
] as const;
