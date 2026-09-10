---
name: Driver dispatch eligibility
description: Durable rules for staged delivery offers, Driver eligibility, and first-winner acceptance.
---

Dispatch offers expand through time-bounded pickup-distance stages, but never beyond the Admin maximum, the Driver's preferred range, or the pickup ETA cap. Eligibility requires an approved, active, compliant, available Driver with a fresh online location, no active delivery, and—when enabled—a matching working-hours window.

**Why:** Showing work to stale, offline, suspended, unapproved, noncompliant, out-of-hours, or already-busy Drivers creates unsafe assignments and misleading offers. A total dispatch deadline also prevents offers from renewing forever.

**How to apply:** Keep pre-acceptance payloads area-level and privacy-safe. Make Drivers in the active stage eligible simultaneously, and keep acceptance transactional so exactly one Driver wins and every competing offer becomes terminal.