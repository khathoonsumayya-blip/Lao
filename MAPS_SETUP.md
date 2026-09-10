# Google Maps Platform setup

Anything Anywhere keeps address fields editable without Google Maps credentials, but it never invents delivery coordinates. Until verified Google location data is available, map panels show an explicit unavailable state and deliveries cannot receive a mapped route.

## Replit Secrets

Add the following values with the Replit Secrets tool. Do not put keys in source files, `.env` files committed to git, browser URLs, or support tickets.

| Secret | Used by | Key restriction |
| --- | --- | --- |
| `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` | Customer web map, driver web map, and dispatch web map | Restrict to **Maps JavaScript API** and HTTP referrers for the production domain plus the Replit development domain. This is a browser-safe, referrer-restricted key. |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Future Android native build | Restrict to **Maps SDK for Android** and the Android application ID plus signing-certificate SHA-1 fingerprints. Do not use it for the web app. |
| `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` | Future iOS native build | Restrict to **Maps SDK for iOS** and the iOS bundle identifier. Do not use it for the web app. |
| `GOOGLE_MAPS_SERVER_API_KEY` | API server only: Places Autocomplete, place details, geocoding, and Directions | Restrict this separate key to the server APIs below. Apply an IP restriction when the deployment has stable egress addresses; otherwise use API restrictions, quotas, alerts, and keep this key only in Replit Secrets. Never expose it to a client bundle. |

The current customer, driver, and dispatch artifacts are Vite web apps, so only the web key is exposed to their browser bundles. The Android and iOS secret names are intentionally reserved for a native Expo build; they are not injected into the web bundle.

## APIs to enable

Enable billing and these Google Maps Platform APIs in the Google Cloud project that owns the keys:

1. **Maps JavaScript API** — web map tiles and markers.
2. **Places API (New)** — address autocomplete and place details.
3. **Geocoding API** — server-side lookup for manually typed pickup and destination addresses.
4. **Directions API** — server-side driving distance, ETA, and route polyline.
5. **Maps SDK for Android** — when an Android native app is introduced.
6. **Maps SDK for iOS** — when an iOS native app is introduced.

Set billing budgets and quota alerts before enabling production traffic.

## How the platform uses maps

- The browser sends no Google server credential. It uses only `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` to load map tiles.
- The API server uses only `GOOGLE_MAPS_SERVER_API_KEY` for autocomplete, geocoding, route distance, ETA, and the route polyline.
- Delivery pickup, destination, and live driver latitude/longitude are persisted in the shared backend. Customer, driver, and dispatch maps render those same values.
- Driver location sharing remains opt-in through the browser/device location permission and is sent only for an active assigned delivery.
- If a provider request fails, address entry remains available and map UI shows an explicit unavailable state. Quotes that require map verification prompt the customer to retry or choose a verified address; no sample coordinates are stored.

## Test checklist

### Web

1. Add `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` and `GOOGLE_MAPS_SERVER_API_KEY` as Replit Secrets.
2. Restart the API Server, Anything Anywhere web workflow, and Anything Anywhere Driver web workflow so the build receives the new public web key.
3. In the customer booking flow, type at least three characters in each address field and select a verified Google address.
4. Complete a test delivery and confirm its route card shows provider distance and ETA.
5. In an assigned driver session, allow location permission. Confirm the customer route and dispatch map receive the live driver marker.

### Android and iOS

When a native Expo build is added, provide the platform-specific public key through the corresponding `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` or `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`, configure the matching native Maps SDK, and test on a physical device with the app ID/bundle ID restrictions enabled.

### Unavailable-map fallback

With either the web key or server key absent, reload the app. The page must still load, address fields must remain editable, and map panels must explain that live routing is unavailable without showing sample pins or routes.