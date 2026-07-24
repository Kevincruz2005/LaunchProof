# Azure cost and free-tier notes

No Azure price or free allowance is guaranteed. Pricing, promotions, subscription eligibility, region availability, taxes, and free grants can change. A Bicep what-if reports resource changes, not a reliable bill. Review the current Azure pricing calculator and the selected subscription before Phase 7.

## Resources that can incur charges

| Resource | Candidate choice | Cost risk |
|---|---|---|
| Container Apps environment | Consumption workload profile | Compute is usage-based. Five always-on replicas (`minReplicas=1`) consume vCPU/GiB time even at low traffic. Free grants, if any, are subscription-specific and can be exceeded. |
| Backend | `0.5 vCPU / 1 GiB`, one replica after cutover | Persistent replica can incur continuous compute cost. It is omitted in candidate mode. |
| Four fixtures | `0.25 vCPU / 0.5 GiB` each, one replica each | Persistent replicas avoid nondeterministic cold starts but may incur continuous compute cost. |
| Log Analytics | PerGB2018, 30 days, 1 GB/day cap | Ingestion and retention can incur charges. The daily cap limits a surge but can temporarily remove observability and is not a cost guarantee. |
| Key Vault | Standard, RBAC, purge protection | Secret operations are metered; usually small but not guaranteed free. |
| User-assigned identity | One identity | Identity itself is normally not the dominant charge; verify current pricing. |
| Existing ACR | Reused; no ACR is created | Storage, pulls, egress, and the existing registry SKU may already incur charges. If no safe registry exists, stop and request approval instead of creating one automatically. |
| Cost budget | Optional | A budget sends alerts and does not stop resources or charges. Some new/subscription types may not support immediate budget creation. |
| Network egress | Public HTTPS/RPC/Supabase/registry traffic | Cross-region and internet egress can incur charges. Co-locate only after security/latency review; do not move Supabase in this hackathon. |

## Why scale-to-zero is not the default

LaunchProof measures timeout and latency behavior. Cold starts can change the healthy/timeout classification and make the controlled fixtures nondeterministic. Therefore all four fixtures and an active backend use `minReplicas=1`. Phase 6 does not offer a hidden `minReplicas=0` cost mode. Phase 7 may test a separate scale-to-zero experiment repeatedly, but must reject it if cold and warm rehearsals differ materially.

## Spending controls

- `maxReplicas=1` on every app.
- Consumption rather than a dedicated workload profile.
- Lowest valid fixture CPU/memory pair; modest backend starting pair.
- Log retention fixed to 30 days with immediate purge and a 1 GB/day safety cap.
- Optional monthly budget notifications at 80% and 100%.
- No Azure Database for PostgreSQL, ACR, Application Insights, custom domain, NAT gateway, firewall, or paid certificate is created.
- Deployment scripts require a literal Phase 7 charge-approval marker.

If guaranteed zero cost is required, do not apply this plan. Keep Railway live and retain the validated IaC only.
