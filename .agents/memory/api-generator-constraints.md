---
name: API generator constraints
description: Compatibility rules for regenerating the shared OpenAPI client and Zod schemas.
---

Use portable OpenAPI regex patterns instead of `format: email` or `format: uri` in schemas that feed the Zod generator. The API generator normalizes its extra end-of-file blank lines automatically before freshness checks and typechecking.

**Why:** The current generator emits `zod.email()` and `zod.url()` for those formats, but the workspace uses a Zod version without those APIs. It also consistently leaves an extra final blank in generated outputs.

**How to apply:** When changing `lib/api-spec/openapi.yaml`, run `pnpm run check:generated`, review and commit the generated files, then run shared-library typechecking. The root typecheck runs this freshness check before compiling dependent packages.
