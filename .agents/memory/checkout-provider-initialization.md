---
name: Checkout provider initialization
description: Concurrency rule for retry-safe checkout payment initialization.
---

The customer checkout advisory lock must cover payment-provider initialization and persistence of the provider payment ID, as well as initial delivery creation.

**Why:** A concurrent retry can otherwise observe a committed delivery and payment row whose provider ID has not been saved yet. Both requests may then attempt provider initialization, which can surface an avoidable failure even if the provider has its own idempotency key.

**How to apply:** When changing checkout creation, payment recovery, or provider integrations, acquire the same customer-and-checkout-key transaction lock before reading or writing the payment record. Persist the provider ID before releasing the lock; retries should return that stored payment.