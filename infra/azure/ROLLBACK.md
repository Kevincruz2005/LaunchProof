# Writer-safe cutover and rollback

Rollback must preserve the invariant that only one registry/payment-recovery writer can operate.

## Cutover prerequisites

1. Current infrastructure is running the Phase 5 code and its migration has been applied.
2. `DATABASE_URL` is compatible with Prisma operational traffic.
3. `LEADERSHIP_DATABASE_URL` is a direct/session-mode Supabase PostgreSQL connection shared by any writer-capable deployment.
4. Azure foundation and four fixtures pass health and deterministic-manifest checks.
5. Images are verified by registry digest and match the exact clean commit.
6. Current ProviderNoRbac what-if and cost summary are reviewed.
7. The user explicitly approves possible charges and writer cutover.
8. Vercel still points to Railway; no traffic change occurs yet.

## Stop-old/start-new sequence

1. Stop or disable the Railway backend writer.
2. Verify Railway no longer serves paid endpoints and its leadership database session lock has been released.
3. Set the separately approved script markers and deploy Azure with `activationMode=active`.
4. Require Azure `/healthz` to report database/registry/x402 ready and `writer_leadership.state=leader`.
5. Run fixture health/manifest acceptance.
6. Run only the explicitly approved paid testnet acceptance from Phase 5; never auto-retry ambiguity.
7. Change Vercel API configuration only in a separate approved phase, then monitor.

## Rollback sequence

1. Stop new traffic to Azure if external routing was changed.
2. Run `rollback.sh` with explicit Azure writer-stop approval. It disables Azure ingress and requests scale-to-zero.
3. Verify Azure has zero running backend replicas and no leadership lock.
4. Inspect persisted ambiguous payments/publications before restarting anything. Do not sign replacements.
5. Restart Railway with the exact compatible schema/configuration.
6. Require Railway health to show it is the sole leader.
7. Restore Vercel API routing in a separately approved operation.
8. Keep Azure fixtures only if their ongoing cost was approved; otherwise remove them through an explicitly reviewed deployment/deletion plan.

The rollback script deliberately cannot start Railway, edit Vercel, delete Azure resources, or touch Supabase/X Layer. These are separate authority boundaries.
