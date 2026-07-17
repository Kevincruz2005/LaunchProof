# LaunchProof Demo Speaking Script

Use the healthy fixture and keep the X Layer testnet explorer tabs ready. A normal demo takes about three minutes.

## Main script

“LaunchProof is a testnet service rehearsal and on-chain evidence system for MCP tools. Before an AI service launches, it lets us test the service's declared behavior, pay its protected endpoint through x402, and publish the exact bounded evidence to X Layer testnet.

This is the live LaunchProof application. At the top of the rehearsal form I connect my OKX Wallet. LaunchProof supports X Layer testnet only. It checks chain ID 1952, the official test USD₮0 contract, the exact amount, recipient, and API route before it asks the wallet to sign. The wallet stays selected only for this open tab; I can change or disconnect it, and a newly opened app session forgets it.

I am using the controlled healthy provider. Its Launch Contract is a real signed JSON document at this public HTTPS address. It declares the MCP endpoint, tool schema, bounded synthetic sample, safety scope, source commit, provider address, and exact x402 paid-delivery terms.

The first 402 response you may see in browser developer tools is expected. In x402, HTTP 402 is the payment challenge. The client validates that challenge, asks the wallet to authorize exactly 0.01 test USD₮0, and retries the same idempotent request with the signed payment header. A second unresolved 402 would be an error; one challenge followed by acceptance is the correct protocol flow.

After approval, LaunchProof runs a bounded pipeline. It verifies the provider signature, discovers the MCP tool, runs the declared fixed sample, confirms a controlled invalid input fails safely, and creates exactly three fresh synthetic challenges. It then makes a second real 0.01 test USD₮0 payment from a separate, capped backend test wallet to the provider's protected delivery endpoint.

Now the result is a Verified Service Passport. All five gates passed: discoverable, contract correct, fresh challenge, safe to rehearse, and paid delivery. The Passport contains the three fresh challenge comparisons and both real payment transaction hashes.

Finally, LaunchProof canonicalizes the evidence, computes its hashes, and publishes the complete bounded evidence through the LaunchProof registry on X Layer testnet. PostgreSQL is only a durable queue and cache; it cannot create proof. The Verify page reads the registry event and storage, recomputes the evidence, verifies the provider signature and both token transfers, and checks the live registry bytecode. Every verification flag must be true.

For this release, the independently verified run is:
`0xfc904b9b51ec8f9036abe8bcf0b67bd4ab655468b0c4c04415cdc91b24b175ef`.

Its LaunchProof payment is:
`0x3e11981acb2fc233622c79f8e2009b175f5a26d18a611965b3c154efc5eda252`.

Its provider paid-delivery transaction is:
`0x2f30444a8d5f9b24fa3b81cd189ab3d388a73e617e99df340eabeadd13f9d9a2`.

Its evidence publication is:
`0x150e7d59ffa00c0d2888d60f830fb6d4aa852948953fb6463aa5173e2ff63d82`.

These are X Layer testnet transactions, not hardcoded success values. The Passport is generated from the observed execution and independently checked against the chain.

LaunchProof is intentionally honest about its boundary: it is a point-in-time rehearsal and a single-writer on-chain attestation, not a security audit, uptime guarantee, mainnet payment, marketplace identity check, decentralized oracle, or OKX endorsement.”

## If the demo is slow

Say: “The payment facilitator and X Layer confirmation are asynchronous. LaunchProof stores the exact candidate transaction and idempotency binding, so refreshing does not create another payment. The same run resumes until the real receipt is proven.”

## If Developer Tools shows 402

Say: “That first 402 is the x402 challenge, equivalent to a payment request. Success is challenge, wallet authorization, paid retry, then HTTP 202 while the rehearsal runs. LaunchProof does not hide the protocol-level challenge.”

## Pages to open in order

1. `https://launchproof-xlayer-testnet.vercel.app/rehearse`
2. Healthy fixture Launch Contract: `https://launchproof-fixture-healthy-production.up.railway.app/.well-known/launch-contract.json`
3. Passport: `https://launchproof-xlayer-testnet.vercel.app/passport/0xfc904b9b51ec8f9036abe8bcf0b67bd4ab655468b0c4c04415cdc91b24b175ef`
4. Verify: `https://launchproof-xlayer-testnet.vercel.app/verify/0xfc904b9b51ec8f9036abe8bcf0b67bd4ab655468b0c4c04415cdc91b24b175ef`
5. X Layer explorer publication: `https://www.okx.com/web3/explorer/xlayer-test/tx/0x150e7d59ffa00c0d2888d60f830fb6d4aa852948953fb6463aa5173e2ff63d82`
