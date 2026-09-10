---
name: Preview outage diagnosis
description: How to distinguish Customer application failures from workspace-wide workflow restarts.
---

Treat an empty React root followed by proxy connection refusal as a server-listener outage unless retained browser or workflow logs show an application exception. If all managed services share the same new process start time and no service has crash, OOM, port-conflict, or restart-loop output, the evidence points to a workspace-wide workflow restart rather than an auth/session defect.

**Why:** A Customer sign-in incident cleared focused fields during a full document reload and then returned 502 while the Vite listener was absent. Retained logs showed no React, Vite, API, dependency, memory, or port failure; every managed workflow had restarted together.

**How to apply:** Correlate process start times, workflow states, open ports, proxy responses, and browser errors before editing auth. Restore the managed workflow directly, preserve stable public auth forms, and verify repeated hard refreshes without adding automatic reload behavior.

Replit development URLs are temporary workspace previews. They normally remain available only briefly after the workspace is left—commonly around ten minutes—then may sleep. A published deployment is required for availability independent of the browser, workspace, or agent session.