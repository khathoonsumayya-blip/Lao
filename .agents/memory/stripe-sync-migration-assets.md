---
name: Stripe Sync migration assets
description: Runtime constraint for using stripe-replit-sync with the API server bundle.
---

Keep `stripe-replit-sync` external from the API server bundle.

**Why:** The package resolves its migration SQL files relative to its installed directory. Bundling it moves the runtime module path to the application output and silently leaves its managed `stripe` schema uninitialized.

**How to apply:** When changing server bundling or dependency externalization, preserve the package directory at runtime and verify startup logs show Stripe synchronization initialized.