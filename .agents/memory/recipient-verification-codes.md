---
name: Recipient verification codes
description: Security boundary and storage rule for delivery-completion one-time codes.
---

Recipient delivery codes must be derived server-side with an HMAC-bound expiry, while the database stores only the delivery-bound SHA-256 hash used for verification. The plaintext code may be recomputed only for the authenticated Customer who owns an active verification-pending delivery; Driver APIs, events, notifications, and logs must never receive it.

**Why:** Delivery completion requires a legitimate code handoff without adding plaintext-at-rest risk or exposing the code to the Driver who is being verified.

**How to apply:** Create or reuse the verification record atomically with the transition to verification pending, keep repeat transitions idempotent, enforce expiry/attempt lockout, and expose the active code only through an owner-checked Customer endpoint or similarly secure recipient channel.