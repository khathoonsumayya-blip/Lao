---
name: Admin fee policy snapshots
description: Consistency rule for Admin-managed delivery fees and checkout pricing.
---

Admin payment-and-fee settings apply when a new delivery quote is generated. Each stored quote captures the exact fee components, tax policy, and policy timestamp that checkout must continue to honor.

**Why:** Changing global fees after a Customer receives a quote must not silently change that Customer's checkout total or corrupt the pricing breakdown persisted with the delivery.

**How to apply:** Load the current fee policy at quote creation, store its calculated components in the quote response, and use only that stored response during checkout. Never recalculate an existing quote from current Settings.