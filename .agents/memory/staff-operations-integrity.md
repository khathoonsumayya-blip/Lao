---
name: Staff operations integrity
description: Authorization and audit boundaries for sensitive delivery-platform operations.
---

Sensitive staff mutations must lock their target row and write the state change with its audit entry in one database transaction. Staff access is role-scoped: dispatchers may need operational delivery context, but support notes, payment/refund details, and full audit metadata remain admin/support-only.

**Why:** A separate audit write can fail after a successful mutation, concurrent staff decisions can record stale prior state, and broad staff audit visibility can reveal private support or payment information.

**How to apply:** For future staff actions, use `FOR UPDATE` before deriving before/after audit values, insert the audit row in the same transaction, and review downstream audit/read APIs for the least-privilege role and metadata scope.

Role-safe mutations must also return a role-safe receipt rather than the full record used internally to perform the action.

**Why:** A response can bypass an otherwise safe list or detail projection and expose payment, contact, document, or rating data to a staff role that may perform the action but is not entitled to those fields.

**How to apply:** Define a narrow response contract for each cross-role staff mutation (for example, ID, operational status, and timestamp), validate it at the route boundary, and test sensitive fields are absent for the least-privileged authorized role.

UI tab visibility never replaces endpoint authorization: support roles that can work tickets must not inherit dispatcher queues, live locations, package photos, or delivery event streams.

**Why:** A role can call an API directly even when the frontend never renders its tab, and an overly broad generic endpoint exposes operational/private data outside its intended workflow.

**How to apply:** Audit every related read, media, and subscription endpoint together with the visible workspace. Keep support on ticket-linked, support-safe records; reserve delivery operations endpoints for dispatch/admin roles. Match the same boundary in direct-storage and database policies.