---
name: Stable mobile auth forms
description: Why public mobile sign-in forms must remain outside reactive session-gate subtrees.
---

Render public sign-in forms on a stable public route rather than as the unauthenticated branch of a session-gated entry component. Do not poll or focus/reconnect-refetch an unauthorized session over an active login form.

**Why:** On mobile touch browsers, a later session-gate update replaced both focused input nodes without navigation, clearing typed values and dismissing focus. An unauthorized-session refetch can cause the same replacement even when the URL does not change.

**How to apply:** Let the entry route decide between authenticated content and a redirect to the public sign-in route. Pause automatic session refresh after authorization fails, but explicitly recheck after login; authorized sessions may keep refreshing. Preserve relevant query parameters, and verify fixes with coordinate taps, real keyboard events, node-identity tracking, and a wait beyond the original reset interval.