# Anything Anywhere Driver App — Build Notes

## What is included

The Driver App is a separate responsive web artifact at `/anything-anywhere-driver/`. It shares the Anything Anywhere API and PostgreSQL database with the Customer App and the dispatcher workspace.

Drivers can:

- create a driver account or sign in with their own secure session;
- complete an application with vehicle, license, and insurance review details;
- upload required license, insurance, and vehicle-registration files;
- see application/approval state and remain offline until approved;
- toggle online availability after approval;
- receive short-lived offers, accept them atomically, and follow an assigned delivery through allowed status transitions;
- explicitly opt in to browser location sharing for an active delivery;
- report safety or delivery issues;
- see stored earnings and payout state;
- verify a recipient’s one-time code without the driver ever being shown that code.

## Cross-app updates

The API exposes an authenticated Server-Sent Events stream at `/api/events`. Driver acceptance, delivery transitions, and driver location writes publish events after the database transaction succeeds. Each connected client is filtered to the relevant customer, assigned driver, or dispatch/support role before receiving an event.

The Driver App listens to these events and invalidates its operational queries immediately. Customer and dispatcher data is persisted in the same transaction, so their existing lists and detail views always read the current state.

## Security and operational constraints

- Driver account creation is limited to `accountType: "driver"`; a driver row starts pending and offline.
- Offer acceptance uses a conditional database update on both unassigned state and delivery status. A second driver cannot win the same offer.
- Drivers can only advance deliveries assigned to them. They cannot set payment-controlled states or directly mark a delivery delivered.
- Recipient completion requires a valid verification record. The OTP is stored as a hash and is not sent in any driver API response.
- Driver identity documents use Replit App Storage private objects. A driver receives a short-lived upload URL, uploads directly to storage, then records the object against their driver profile. The application stores only the private object path and safe verification metadata—not raw document contents.
- Mapping, recipient SMS/email delivery, live turn-by-turn navigation, and payment payouts depend on configured external providers. The app shows real persisted data when those providers are unavailable and does not invent completion or payout results.

## Development checks

Run the following after shared API/schema updates:

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/anything-anywhere run typecheck
pnpm --filter @workspace/anything-anywhere-driver run typecheck
```

Restart the API, Customer App, and Driver App workflows after server or generated-client changes.