---
name: Shared package rebuilds
description: Rebuilding generated contracts and declaration artifacts after shared API or database schema changes.
---

After changes that touch the shared database schema or OpenAPI contract, rebuild the shared artifacts before relying on a dependent artifact's typecheck.

**Why:** Dependent TypeScript projects may resolve previously emitted declaration files even though the workspace source has changed, which can present as missing shared exports or endpoint types after a merge.

**How to apply:** Run the API contract generator for OpenAPI changes and a TypeScript build for the database package before typechecking or restarting the API server.

When the generator runs while Vite development servers are active, their temporary removal of generated client files can emit transient pre-transform/HMR missing-file warnings. Production builds and subsequent reloads are unaffected once generation completes.

**Why:** The generator clears and recreates its output directory, creating a short interval where Vite resolves files that do not yet exist.

**How to apply:** Treat these warnings as a development-cycle artifact only after a clean generated-contract check and production build; restart a dev server if the preview does not recover.