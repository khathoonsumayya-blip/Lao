---
name: Requester support continuity
description: Durable access requirements for Customer and Driver support conversations.
---

Requester-visible support replies must remain reachable after reload and on later visits through an ownership-scoped ticket or incident history. Notifications for replies must carry only a safe source and record identifier that opens the corresponding owned conversation.

**Why:** A conversation API and notification are not sufficient if the requester UI remembers the record only in component-local state; later replies become effectively unreadable.

**How to apply:** Whenever support reply behavior changes, preserve requester list access, URL-backed selection or deep links, safe notification linkage, and API/RLS ownership checks for both Customer tickets and Driver incidents.