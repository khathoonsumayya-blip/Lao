---
name: Development schema readiness
description: Validation constraint when the development database has not received the current Drizzle schema.
---

Before validating database-backed browser or integration flows, ensure the normal task-merge schema setup has brought the development database up to the current Drizzle definitions.

**Why:** A stale local schema can make otherwise unrelated flows fail early—for example, missing current delivery or identity columns prevents checkout and authenticated test setup from reaching the feature under test.

**How to apply:** Do not add startup-time migrations or manually target production. Let the established post-merge development setup apply the schema, then rerun the validation suite.