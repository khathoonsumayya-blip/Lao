---
name: RLS release gate
description: Dedicated Supabase policy checks must prepare their own database before assertions run.
---

The delivery RLS release check must use a dedicated Supabase test database supplied through the workspace secret `SUPABASE_TEST_DATABASE_URL`; it must never fall back to the shared development database. Use that project's Supavisor Transaction Pooler URI (rather than its direct database host) when the runner lacks direct-host DNS or IPv6 connectivity. Before assertions, apply the ordered SQL schema migrations and then the RLS companion migration in one transaction.

**Why:** RLS tests mutate fixtures and validate direct-client policies, so sharing an application database risks data contamination and can make an unapplied policy migration look like a passing release.

**How to apply:** Keep the release validation command pointed at the API package's RLS script. Provision or rotate only the isolated test database secret through the secure secrets flow, and treat a missing secret as a blocking configuration error. After rotating the secret, allow the environment refresh to propagate before rerunning the command.

Write-only table insert tests must assert the command's affected-row count instead of using `INSERT ... RETURNING`; `RETURNING` also invokes SELECT-policy checks and can reject a valid write when no read policy exists.

**Why:** Driver locations intentionally allow direct inserts without exposing location rows to direct clients, so a returning clause tests more than the insert policy.

**How to apply:** Use a transaction-scoped authenticated execute helper for successful writes, and reserve returned rows for tables with an explicit SELECT policy.