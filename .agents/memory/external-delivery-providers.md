---
name: External delivery providers
description: Durable boundary for payment, mapping, private media, and live location integrations.
---

The shared backend must remain useful without Stripe charging, Google Maps credentials, or live GPS availability: persist test payments using safe provider metadata; return explicit mapping-unavailable results instead of invented coordinates/routes; and keep assigned-driver location/status endpoints ready without pretending data exists.

**Why:** Those external services require credentials, browser permissions, and provider configuration that are not part of the workspace; faking them would make production behavior unsafe. Package photos use private App Storage only, and an upload capability must stay bound to its delivery participant, exact metadata, and expiry before becoming an attachment.

**How to apply:** Keep raw card numbers/CVCs out of PostgreSQL, use provider IDs and metadata only, gate server-side mapping calls on configured credentials, and treat live driver location as opt-in. Never expose package-photo object paths publicly; use short-lived signed URLs plus a caller-owned pending upload record that is consumed after object verification.