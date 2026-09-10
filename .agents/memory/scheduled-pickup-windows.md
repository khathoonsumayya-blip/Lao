---
name: Scheduled pickup windows
description: Durable rules for quoting, persisting, displaying, and dispatching scheduled Customer deliveries.
---

Represent a scheduled pickup as an immutable start/end timestamp pair captured by the quote and copied unchanged to the delivery. ASAP requests have no schedule timestamps. Clear an existing quote or checkout whenever the Customer changes pickup timing.

**Why:** A priority flag alone cannot preserve the promised window across checkout, reloads, and downstream views, and stale quotes can temporarily misstate the selected timing.

**How to apply:** Validate both timestamps together, reject past or reversed windows, expose the pair to each authorized Customer/Driver/Admin view, and preserve pre-acceptance Driver privacy. Keep paid scheduled deliveries out of matching until the configured lead period before pickup; record activation only for rows won atomically by that worker.