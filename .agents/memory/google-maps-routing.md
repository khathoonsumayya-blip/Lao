---
name: Google Maps routing
description: Credential boundary and routing behavior for customer delivery maps.
---

Booking-preview routes must come from the API server's Google Directions integration and be rendered in the browser from its encoded polyline. Do not call the Maps JavaScript `DirectionsService` from the Customer app.

**Why:** The browser-safe referrer-restricted key is intentionally limited to Maps JavaScript loading. A client Directions request can be denied even while tiles and markers load, producing a customer-visible console failure and an unreliable preview.

**How to apply:** Keep the server key confined to API routes that verify addresses and calculate driving routes. Give browser maps only verified coordinates and encoded polylines; retain clear unavailable states if server verification or routing fails.