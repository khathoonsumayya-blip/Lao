---
name: Offer response metrics
description: How Driver acceptance metrics remain truthful across direct assignments, declines, and expired offers.
---

Acceptance rate must use persisted Driver offer responses only: accepted divided by accepted plus declined. Direct assignments and expired offers do not enter the denominator.

**Why:** Inferring acceptance from assigned deliveries fabricates responses, while allowing stale declines after offer expiry changes performance metrics after the Driver no longer had a live choice.

**How to apply:** Snapshot expiry on each offer attempt, persist accepted/declined/expired terminal outcomes atomically, reject stale accept or decline actions, and scope both attempts and metrics by their actual response dates.