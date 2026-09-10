---
name: Driver auth and onboarding guards
description: Non-obvious session-isolation, query-observer, and transaction rules for the Driver app.
---

Wrong-role access to the Driver app must deny Driver content without calling the shared global signout endpoint.

**Why:** Customer and Admin identities can legitimately share the broader authentication system; global signout from a Driver 403 revokes unrelated sessions, including the dedicated Admin proof.

**How to apply:** Treat Driver-profile 401/403 as a local Driver access gate. Reserve global signout for an explicit user logout action.

One Driver-session provider must own the only profile query; the guard and every page consume that shared result instead of mounting profile observers.

**Why:** In TanStack Query, `refetchOnMount: false` does not prevent a data-less errored query from loading when another observer mounts. Without `retryOnMount: false`, Layout/Welcome start another 403 request, the gate returns to its loading branch and unmounts them, then the error remounts them—creating a millisecond request loop.

**How to apply:** Keep the generated profile hook inside the provider only, with `retryOnMount: false` and interval/focus/reconnect refetches disabled. The provider must explicitly establish and clear sessions so login/logout updates are immediate. Keep Welcome mounted while the probe settles and never navigate to the route already active.

Lock required Driver rows and optional onboarding-application rows in separate queries within one transaction.

**Why:** PostgreSQL rejects `FOR UPDATE` against the nullable side of an outer join, turning otherwise valid onboarding submissions into generic bad requests.

**How to apply:** Lock the mandatory profile/driver join first, then select and lock the optional application record separately before merging and validating onboarding state.