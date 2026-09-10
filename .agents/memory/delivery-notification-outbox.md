---
name: Delivery notification outbox
description: Concurrency and transport invariants for delivering durable delivery-update notifications.
---

Delivery status changes only enqueue notification attempts; workers own all delivery, retry, and transport work. A worker must claim attempts with a lease and unique token, renew that lease while an external send is in flight, and give providers the stable attempt ID as their idempotency key. The in-app transport must materialize the notification and mark the attempt delivered in one transaction.

**Why:** Delivery transitions are authoritative, one-time state changes. Retrying a transport must never rerun them, and overlapping workers or a slow provider must not produce duplicate coordination messages.

**How to apply:** New channels should implement the transport contract and forward its idempotency key to the provider. Keep retry updates guarded by the claim token, use capped exponential backoff, and preserve the slow-send competing-worker regression test when changing worker behavior.