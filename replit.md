# Anything Anywhere

Anything Anywhere is a Raleigh delivery concierge with customer booking, order tracking, support, and role-aware dispatch foundations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080 by default)
- `pnpm --filter @workspace/api-server run typecheck` — rebuild/verify the shared database declarations, then typecheck the API
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run check:generated` — regenerate and verify the checked-in API hooks and Zod schemas
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — Drizzle source of truth for profiles, customers, drivers, deliveries, status history, payments, support, and operations
- `lib/db/migrations/` — SQL-first PostgreSQL/Supabase schema and RLS companion
- `lib/db/src/seed.ts` — explicit development-only demo seed; never runs during API startup
- `artifacts/api-server/src/lib/auth.ts` — session/cookie/bearer resolution and role enforcement
- `artifacts/api-server/src/lib/delivery-service.ts` — quote, ownership, delivery state machine, and audit persistence
- `lib/api-spec/openapi.yaml` — source of truth for the typed customer, driver, and admin API
- `artifacts/anything-anywhere/src/pages/customer-pages.tsx` — customer booking, order, detail, profile, wallet, and support flows

## Architecture decisions

- Customer identity is derived from the authenticated session/profile on the server; customer IDs are never accepted from request bodies or query strings.
- The API accepts a hashed opaque session from `aa_session` or Bearer auth. A development-only seeded identity is available only outside production and can be disabled with `ALLOW_DEMO_SESSION=false`.
- Delivery status transitions are an explicit state machine and write a status-history row plus an audit row in the same transaction.
- Payment records contain provider-safe identifiers and metadata only. Test checkout is persisted as a test provider record; Stripe charging needs provider credentials/webhooks.
- Driver GPS ingestion is represented by assigned-delivery location records, but live provider ingestion remains gated on the driver app/provider credentials.

## Product

Customers can receive a server-calculated quote, create a test-payment delivery, see only their own persisted orders and saved places, follow a status timeline, and send support tickets. Driver-safe assigned-delivery/status/location endpoints and admin/dispatcher status/assignment/audit boundaries are available for future operational UIs.

## User preferences

No project-specific preferences recorded.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` and commit the generated files. `pnpm run typecheck:libs` and the full `pnpm run typecheck` automatically run `pnpm run check:generated` first, so stale generated contracts fail before dependent typechecks.
- Apply development schema changes with `pnpm --filter @workspace/db run push`; production schema changes use the Replit Publish flow.
- To create demo records locally, run `ALLOW_DEMO_SEED=true pnpm --filter @workspace/db run seed`; the command refuses production and the API never seeds on startup.
- The same development seed creates the Admin Desk account `demo.admin@anything-anywhere.local` with password `DemoAdmin2026!`. Open `/admin` after seeding and sign in with it. These credentials and the seed command are development-only; production still requires an active profile with an explicitly authorized staff role.
- The Supabase policies in `lib/db/migrations/supabase_rls.sql` are a deployment companion. Application-level ownership checks remain required when the API uses an elevated database role.
- Set `CORS_ORIGIN` to the exact deployed web origin(s) before production. Unset production configuration intentionally rejects credentialed cross-origin browser requests.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
