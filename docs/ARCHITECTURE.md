# LaunchProof architecture

Last evidence review: 2026-07-24. LaunchProof is an X Layer **testnet-only** trust gate for agent-service providers (ASPs). Before an AI agent hires or pays an ASP, it can request a chain-backed decision: `ALLOW`, `WARN`, `BLOCK`, or `REHEARSAL_REQUIRED`.

The decision is derived from a signed Launch Contract and an independently reconstructed Service Passport. It does not itself spend, sign, publish, or start a rehearsal.

## Deployed topology

```text
Browser / AI agent
  |  PassportGate REST or public MCP (read-only)
  v
Vercel web app  --------------------->  Azure Container Apps backend (one writer)
  |                                           |              |
  |                                           |              +-- isolated candidate Supabase PostgreSQL
  |                                           |                  (queue, cache, recovery; not proof authority)
  |                                           v
  |                                     signed HTTPS/MCP Launch Contract
  |                                           |
  |                              bounded paid rehearsal when explicitly approved
  |                                           v
  +------------------------------> X Layer testnet registry + ERC-20 receipts
                                               |
                                               v
                                      independent verifier / PassportGate
```

The currently recorded production web alias is `https://launchproof-xlayer-testnet.vercel.app`. Its API base is the Azure backend at `https://launchproof-backend.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`. The prior Railway API is retained with zero active deployments for rollback; it is not the active writer. The four controlled fixtures run in the same approved Azure candidate boundary.

## Network and proof anchors

| Anchor | Verified value |
| --- | --- |
| Network | X Layer testnet, `eip155:1952` |
| Test token | test USD₮0, six decimals, `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| Registry | `0x99313b45b234e06eba1fc8fe7bee101b7f2f2c37` |
| Registry creation block | `35805522` |
| Runtime code hash | `0xe367ae4a310bf429601d9cc43d4191e7d2c9e90056d3183918ba7cc8ac872553` |
| Evidence capacity | 65,536 canonical bytes |

The backend starts only after it verifies the chain identity, registry creation boundary, runtime bytecode hash, immutable registry writer, test-token bytecode/decimals, and configured public origins. Mainnet is refused by configuration; there is no mainnet fallback.

## Rehearsal and evidence flow

1. An ASP exposes a signed Launch Contract at a public HTTPS URL. It declares the provider identity, source revision, MCP endpoint, synthetic sample, controlled invalid input, fresh-challenge profile, safety scope, and any exact x402 delivery terms.
2. A user explicitly approves the incoming x402 payment in an EVM wallet. The browser validates chain, asset, amount, recipient, and route before signing.
3. The backend makes a bounded run: contract validation, tool discovery, fixed sample, controlled invalid input, exactly three fresh challenges, and—only where the contract requires it—one allowlisted provider-delivery payment from a separate capped test wallet.
4. The worker keeps only bounded, declared evidence; canonicalizes it with JCS; computes hashes; and publishes the record once to the append-only registry.
5. Readers reconstruct the Passport from registry storage, the `RunPublished` event, transaction receipts, runtime bytecode, provider signature, and canonical evidence. PostgreSQL may help locate/cache a run but cannot make it valid.

The five evidence gates are `discoverable`, `contract_correct`, `fresh_challenge`, `safe_to_rehearse`, and `paid_delivery`. `Verified` requires all five to pass and both required testnet transfers to be independently proven.

## PassportGate decision model

PassportGate is a read-only policy layer shared by REST, public MCP, and the Judge Mode UI.

| Result | Meaning |
| --- | --- |
| `ALLOW` | A matching Passport is `Verified`, all verification/settlement checks pass, and its chain timestamp is within the warning window. |
| `WARN` | The same full proof passes, but the Passport is older than the warning window and not yet expired. |
| `BLOCK` | A matching Passport exists but its status, gates, identity, signature, hashes, registry/readback, transfers, or database/chain agreement fails. |
| `REHEARSAL_REQUIRED` | No valid matching Passport exists, the contract/source/provider identity changed, or the valid Passport is beyond the maximum age. The returned action is non-executing and requires explicit payment approval. |
| `UNAVAILABLE` | An RPC/index/contract-fetch dependency cannot be verified. This is not a trust decision and never becomes `ALLOW` or `BLOCK`. |

Freshness uses the anchored chain block timestamp, not application-server time. The default warning and maximum windows are 24 and 168 hours, configurable only within validated safety bounds.

## Single-writer safety and recovery

The active backend uses a PostgreSQL session advisory lease with monotonically increasing fencing. A writer checks leadership before mutation/broadcast and persists immutable transaction candidates for recovery. During Phase 8, Railway was stopped before Azure became writer; final acceptance recorded one active Azure revision, one replica, and one leadership holder. A read-only backend mode exists for candidate deployments and cannot create a leadership session, initiate payments, or publish.

## On-chain versus off-chain

On chain: the registry record/event, canonical evidence bytes and hashes, registry timestamp/writer, and the receipts for the two required test USD₮0 transfers and evidence-publication transaction.

Off chain: HTTPS/MCP execution, contract fetches, bounded comparison work, operational queues/cache/recovery metadata, UI presentation, and external provider availability. The registry proves what the configured writer published at a testnet time; it does not place HTTP execution into consensus.

## Boundaries

LaunchProof is not an audit, certification, security guarantee, uptime monitor, marketplace identity check, future-behaviour guarantee, decentralized oracle, mainnet system, or OKX endorsement. It evaluates one declared, consenting service at a point in time using synthetic/public inputs. Test USD₮0 and test OKB have no monetary value.
