---
name: Admin session separation
description: Why Admin browser access requires proof distinct from the shared application session.
---

Admin browser access must require an Admin-scoped session proof in addition to the shared authenticated session. A profile’s current staff role alone is not evidence that its browser session originated from the Admin login.

**Why:** Promoting an existing Customer profile to Admin caused its preserved Customer sessions to resolve with the new Admin role, allowing those old browser cookies to enter the Admin app without showing the Admin login.

**How to apply:** Admin UI session checks and cookie-authenticated Admin API requests must require the dedicated Admin session cookie. Issue it only after active staff credentials succeed through an Admin-scoped sign-in; clear and revoke it on logout. Admin child pages must derive role-gated controls from the Admin shell’s session proof, never from a generic shared-session query.