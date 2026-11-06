# Authentication and ownership

## Choice: opaque server-side sessions

MongoDB-backed sessions allow immediate logout revocation without JWT signing/rotation machinery or long-lived browser storage. Login and registration generate a fresh 32-byte random ID, put it in an HttpOnly, host-only, SameSite=Strict cookie at Path=/api, and persist only its SHA-256 hash. The default fixed lifetime is 30 minutes, configurable to 5–60. Requests always check expiration; TTL indexes only clean up old documents. Session restoration does not extend the lifetime.

Cookie Secure is false only for local loopback HTTP. HTTPS would require Secure=true and a separate deployment/security design. No token is stored in localStorage/sessionStorage. This session choice follows [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); SameSite is supplemented with explicit CSRF protection.

Passwords use pure-JavaScript bcrypt with cost 12, allowing portable Windows/local installation without native binaries. A minimum 12 Unicode characters and maximum 72 UTF-8 bytes avoids silent bcrypt truncation. Hashes include bcrypt's random salt; passwords never enter jobs, source documents, results or logs. Unknown-account login performs a dummy bcrypt comparison to avoid the obvious fast failure path. See [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). There is no claim of memory-hard Argon2 protection or exhaustive breached-password screening.

## Request flow

```mermaid
sequenceDiagram
    participant B as React browser
    participant A as Express
    participant M as MongoDB
    participant Q as BullMQ/Redis
    B->>A: Register/login (Origin + request marker)
    A->>M: Validate user / bcrypt hash
    A->>M: Store hash(random session ID), user ID, CSRF, expiry
    A-->>B: HttpOnly cookie + public user/CSRF/expiry
    B->>A: Private request (cookie; writes also include CSRF)
    A->>M: Validate live session + load user
    A->>M: Read/write resource for authenticated owner
    A->>Q: Enqueue owner-scoped job or read owned job
    A-->>B: Authorized, sanitized response
```

`src/auth/index.js` handles credential validation, cookies, session rotation, expiry checks, origin/request-marker checks, CSRF and rate limits. `src/auth/store.js` owns MongoDB users/sessions and indexes. `src/app.js` mounts authentication before every private job/import/statistics route. Omitting an auth store does not create an anonymous bypass: private requests fail closed.

State-changing browser requests must match APP_ORIGIN (or the configured local API origin), carry X-JobPulse-Request:1, and, once authenticated, carry the session's X-CSRF-Token. Tokens are compared using fixed-format validation and timing-safe comparison. The custom marker plus Origin validation protects login/registration as well. No permissive CORS is enabled. CLI clients may omit Origin but must supply explicit headers and session credentials.

Unauthorized calls return 401. An authenticated caller requesting another user's resource gets the same 404 as a nonexistent resource. CSRF/origin failures return 403, invalid input 400, duplicates 409 for registration, and limits 429. Infrastructure failures remain sanitized 503 responses. Error stacks, raw credentials and sessions are never returned.

## MongoDB models and authorization

| Collection | Relevant fields and constraints |
| --- | --- |
| users | UUID `_id`, normalized unique `email`, `passwordHash`, `createdAt` |
| sessions | `_id=SHA256(token)`, `userId`, `csrfToken`, `createdAt`, `expiresAt`; TTL index on expiry |
| jobs | Unique job `_id`, `ownerId`, `type`, `createdAt`; index on owner/creation |
| imports | Unique scoped import `_id`, immutable source, `ownerId`, schema version, checkpoints; owner/creation index |
| records | `ownerId`, import ID, row number and validated fields; preserved unique `(importId,rowNumber)` plus owner/import index |

The request's owner is always taken from the verified session's loaded user. Simulation JSON still accepts only type/mode, uploads accept only the file part, and query parameters reject unknown owner/user fields. Neither an owner ID nor a resource ID supplied by a caller is authorization.

The jobs catalog is written server-side before enqueueing. History and statistics query only that user's catalog, then verify each BullMQ job's owner again. Direct details require both catalog ownership and queue-payload ownership, with a second ownership check after refreshing snapshot fields. Import summaries always filter MongoDB by owner and exclude source bytes. There is no source download route. Results remain behind the same job-ownership checks.

Unlike the previous global 500/state inspection window, user-specific reads inspect all cataloged jobs belonging to that user with at most ten concurrent Redis job reads. Removed/unacknowledged queue jobs are excluded from retained-job totals. This avoids disclosing other users' counts or letting their workload truncate someone else's history. It is O(the user's catalog size), suitable for local workloads; a large-scale service would need a durable reconciled status projection rather than repeated complete live reads.

## Scoped CSV idempotency

New import identity is SHA-256 of schema-version prefix, authenticated owner UUID and exact bytes. The same bytes within one account reuse a retained job; identical bytes under a different account produce a different ID and separate source/records. The worker reads the owner from trusted queue metadata, requires a valid UUID, loads only that owner's source and recomputes the scoped hash before writing. Batches/checkpoints carry the owner through every database operation.

Unique import IDs already incorporate ownership, so the existing `(importId,rowNumber)` unique constraint remains valid without rebuilding or deleting old indexes. Accepted records now also store owner metadata. Retries still reparse immutable source, use `$setOnInsert` row writes and monotonic checkpoints. Authentication/session expiry does not interrupt work already accepted; jobs contain a durable owner ID, not a session token or password.

## Existing unauthenticated data

No data is deleted, automatically claimed or assigned to the first account. Unowned queue jobs have no catalog entry and fail direct-owner checks; unowned imports fail owner-filtered reads. Trusted workers can still finish legacy jobs using the legacy hash format and queries explicitly restricted to documents without owner metadata. That compatibility exists only in worker/storage code, not in HTTP authentication or ownership middleware.

Re-upload an old CSV after login to create a new scoped import. Any future migration would require an explicit, reviewed ownership mapping; merely trusting a supplied ID or adopting all old data would be unsafe. Old API/worker processes must be restarted: running JavaScript does not reload from edited files automatically. In particular an old unauthenticated API continues its old behavior until stopped. Containers remain unchanged.

## React behavior

`AuthProvider` restores GET /auth/session, keeps public user/CSRF/expiry only in memory, handles timeout/private-API 401, and clears private state on logout. Session changes notify same-origin tabs through BroadcastChannel; visibility restoration covers browsers without it. Account changes key/remount the protected subtree so cached resource data from a previous user is discarded.

Protected routes wait for restoration, redirect unauthenticated users to login, and preserve safe internal return paths. Restoration infrastructure errors show a retry state instead of falsely claiming the account is unauthenticated. Login/registration forms validate input and show generic server failures. Logout only clears the UI after server revocation succeeds (or the session is already invalid); a database outage does not pretend revocation happened.

The shared API layer attaches same-origin credentials, the request marker and in-memory CSRF. Polling, uploads, history and results continue through that layer. Vite exposes no database/auth secret to the browser. React client protection improves UX; every authorization decision is still enforced by Express/MongoDB.

## Rate limits and local assumptions

Registration: 20/IP/15 minutes. Login: 40/IP/15 minutes and 10/IP+email/15 minutes. Restoration: 150/IP/minute. Private API: 300/user/minute. CSV POST uploads: 10/user/minute; summary GET polling is not charged to that upload limit. Limits use in-process memory and reset on restart; API replicas would need a shared limiter store. Proxy IP forwarding is not trusted.

Trust the local OS, database and Redis administrators, worker processes and same-host applications. Databases remain local services with their existing unauthenticated configuration; application sessions do not protect against direct administrator DB access. Local HTTP is not encrypted, and cookies are not isolated by port. This is not a public-production security guarantee.

There is no email verification, password reset, MFA, session/device-management UI, logout-all-devices, account deletion, admin role, sharing or automatic legacy migration. Registration's duplicate-email status can reveal account availability. XSS/same-origin code execution can still act as a user despite HttpOnly cookies. Sessions expire or revoke current credentials; accepted jobs keep running and their owned records remain stored.

The source/catalog enqueue gap, lack of outbox, partial-batch failure semantics, indefinite retention and single-instance database availability limits from earlier milestones remain. No Docker settings, paid infrastructure or cloud services were added.

## Diagnosing the registration-page route error

The reported “We couldn’t find that job / Route not found” came from two separate issues: a pre-auth API process on port 3000 returned 404 for the correctly named `/api/v1/auth/session` endpoint, and the shared frontend notice labeled every 404 as a job lookup failure. Direct Express and Vite-proxied probes reproduced the same response, ruling out an invented client path or Vite rewrite issue.

The running API must load the current `src/api.js`/`src/app.js`, which mount `/api/v1/auth` before private routes. An anonymous session probe should return 401; a signed-in probe should return 200. Restart a stale non-watch API, or use the existing `npm.cmd run dev` watch command during development. No authentication endpoint, middleware policy or contract needs changing.

Frontend API errors now retain resource context. An account-route 404 remains an actionable visible service failure with retry, while only actual job-route 404s use the missing-job title. A regression reproduces the missing auth route, verifies the service error stays visible, then removes the simulated outage, retries against the real endpoint and completes registration. Technical implementation details remain here; auth-page copy focuses on the user's work and retains password requirements.

The confirmed stale API was restarted during this refinement. Live probes then returned 401 for anonymous session restoration both directly on port 3000 and through Vite on 5173, plus 400 for an empty registration payload, confirming the existing auth routes are loaded. Workers and containers were not restarted. The refinement's 11 browser tests, frontend production build and syntax checks passed, including desktop/mobile form checks and the missing-auth-route recovery regression.
