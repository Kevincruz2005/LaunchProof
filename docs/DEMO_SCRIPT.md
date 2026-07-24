# 90-second LaunchProof demo script

Target length: about 90 seconds at a clear speaking pace. All identifiers below are verified X Layer **testnet** evidence from 2026-07-24.

“LaunchProof is a trust gate for AI agents before they hire or pay an agent-service provider. A signed Launch Contract goes in; `ALLOW`, `WARN`, `BLOCK`, or `REHEARSAL_REQUIRED` comes out. This is proof-backed, not a reputation score or database claim.

Here is Judge Mode. Checking a Passport is read-only: no wallet, payment, or rehearsal starts. It verifies the current contract identity, source revision, provider signature, five gates, settlement receipts, registry storage and event data, runtime bytecode, and canonical hashes.

For the healthy controlled fixture, the result is `ALLOW`. Its Passport came from a bounded paid rehearsal: tool discovery, the declared sample, controlled invalid input, and three fresh challenges. It also verified two exact 0.01 test USD₮0 payments—an incoming x402 payment and provider delivery—and published bounded evidence to X Layer testnet.

The accepted run is `0x08d282…b41e51`; its publication is `0x5e8a74…16f86e`. The explorer shows the real testnet transaction, and the Verify page reconstructs the evidence independently. PostgreSQL is cache and operational storage, never proof authority.

No matching Passport means rehearsal required; stale proof warns; any proof failure blocks; dependency failure is unavailable, never approval. LaunchProof is X Layer testnet-only, uses synthetic public samples, and provides point-in-time evidence—not an audit, future guarantee, decentralized oracle, or mainnet payment system.”

## Verified links for the recording

- Judge Mode: `https://launchproof-xlayer-testnet.vercel.app/judge`
- Passport: `https://launchproof-xlayer-testnet.vercel.app/passport/0x08d2827ea8ff483cbfc872ef0023925776775c541d80ff09f0d3d175b8b41e51`
- Independent verifier: `https://launchproof-xlayer-testnet.vercel.app/verify/0x08d2827ea8ff483cbfc872ef0023925776775c541d80ff09f0d3d175b8b41e51`
- Evidence publication: `https://www.okx.com/web3/explorer/xlayer-test/tx/0x5e8a74cc38c08594b2849c6786841ea86e57a58531fc6fc499e4c9b22e16f86e`

Do not trigger another paid rehearsal in the recording. Use the verified Passport and public read-only pages.
