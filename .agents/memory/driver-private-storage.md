---
name: Driver private storage
description: Driver document uploads use private App Storage paths with database ownership checks because the project uses custom signed sessions.
---

Driver identity documents must not use the public object search path or generic unauthenticated storage serving. The custom session system is the authority for upload and document metadata routes; the database associates each private object path with its driver, and access checks must verify that ownership before serving or accepting a document.

**Why:** The project has secure HTTP-only sessions but does not use the Replit Auth middleware assumed by the stock object-storage template. Reusing that template unchanged would either reject valid drivers or expose private documents.

**How to apply:** Keep private object paths under the driver-specific prefix, issue short-lived upload URLs only to approved session roles, verify the uploaded object exists before recording metadata, and never return document contents through driver onboarding JSON.