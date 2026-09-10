---
name: Safari runtime overlay events
description: Explains why Safari can show a synthetic unknown runtime error despite no application exception.
---

The installed Replit Vite runtime overlay plugin treats every `window.error` event as an application exception. When Safari supplies no `Error` object, the plugin creates its own `(unknown runtime error)` sentinel and reports that synthetic error to Vite.

**Why:** Mobile Safari produced overlay reports with an empty application stack while browser instrumentation showed no `pageerror`, no uncaught JavaScript exception, and normal API behavior. The plugin source confirmed the sentinel is generated inside its injected client.

**How to apply:** Keep the Replit runtime-error modal plugin disabled in both Admin and Driver artifacts. Diagnose genuine exceptions through browser `pageerror`, resource-error targets, and workflow stacks instead.

Do not enable Cartographer or the development banner in the Admin artifact: their injected fixed, extremely high-z-index elements can overlap authentication inputs and produce unreliable touch targeting in real iOS Safari even when desktop WebKit hit-testing reports `pointer-events: none`.

**Why:** The affected iPad could type in the email field but could not type in the password field. Development plugins and the preview runtime injected full-viewport, extremely high-z-index elements even when desktop WebKit reported `pointer-events: none`.

**How to apply:** Keep Admin authentication inputs native and browser-owned with no input event handlers or appearance reset. Remove exact-match empty preview overlays rather than relying on their declared pointer behavior.

On the affected physical iPad, both a native password input and an ordinary text input using `-webkit-text-security` rejected keyboard characters even after hit targets and overlays were eliminated.

**Why:** Emulated iPad WebKit accepted input in both cases, so browser automation is not sufficient evidence for this device-specific failure.

**How to apply:** Treat physical-device feedback as authoritative. The compatibility path that avoids both Safari secure-entry mechanisms was confirmed on a physical iPad: password entry, Admin login, Settings, logout, and the post-logout Admin gate all worked correctly. Preserve it unchanged.