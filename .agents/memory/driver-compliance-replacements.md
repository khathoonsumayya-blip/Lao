---
name: Driver compliance replacements
description: Durable approval, audit, document-expiry, and active-delivery rules for Driver profile changes.
---

Compliance-sensitive Driver profile or document replacements must remain pending until an Admin decision. Preserve the currently approved values, record actual approved old values versus requested new values in the audit, and snapshot the assigned vehicle on each delivery.

**Why:** Applying a request before approval silently replaces trusted compliance data, while reading live profile values from an active delivery lets later edits rewrite its operational history.

**How to apply:** Store allowlisted pending values separately, keep private document paths out of read contracts, and apply approved values atomically with the Admin decision and audit entry. Never rewrite an active delivery snapshot.

Current approved, unexpired license, insurance, and vehicle-registration documents are required at every boundary that grants new work.

**Why:** Checking only when a Driver toggles online leaves already-online Drivers eligible after a document expires.

**How to apply:** Use one shared eligibility rule for going online, offer visibility, acceptance, dispatcher assignment, and approved-driver selection. Deny future work without cancelling or mutating an existing delivery.