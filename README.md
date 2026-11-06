# JobPulse

A free, locally runnable background-job processing project: Express, BullMQ/Redis, independent Node workers, MongoDB Community, and a React dashboard. Accounts use bcrypt password hashes and MongoDB-backed sessions. Jobs, CSV imports, results, history and statistics are isolated per user. No paid hosting, cloud account or paid API is required.

## Start locally

Use Node.js 24 (or 22.12+), npm, and an already running Docker Compose engine.

```powershell
npm.cmd ci
npm.cmd --prefix web ci
# Only if .env does not already exist:
Copy-Item .env.example .env
```

Root configuration:

```dotenv
PORT=3000
REDIS_URL=redis://127.0.0.1:6380
MONGODB_URL=mongodb://127.0.0.1:27018/jobpulse
APP_ORIGIN=http://localhost:5173
SESSION_TTL_MINUTES=30
SESSION_COOKIE_SECURE=false
```

Existing environment variables take precedence over root `.env`. Redis uses host port **6380**, MongoDB **27018**. `APP_ORIGIN` is the exact browser origin, without a trailing slash. The session lifetime must be 5–60 minutes. `SESSION_COOKIE_SECURE=false` is only for this loopback HTTP setup; HTTPS deployment would require secure cookies and a separate deployment review. No JWT/signing secret is needed for opaque server-side sessions.

The existing Compose services/ports/volumes are unchanged. If services are already running, leave them running. For a fresh setup only:

```powershell
docker compose up -d redis mongodb
```

Run in separate terminals:

```powershell
# API: localhost:3000
npm.cmd start
# Worker: concurrency 1
npm.cmd run worker
# React: localhost:5173
npm.cmd run web
# Optional additional independent worker
npm.cmd run worker
```

**Restart all API and worker processes started before this authentication change.** Old API processes still run their old unauthenticated code; old workers cannot interpret new owner-scoped CSV identities. Stop only your owned terminals with Ctrl+C, then use the commands above. No Docker restart or volume reset is needed. MongoDB is now required for API authentication, including simulation submission; the simulation handler itself remains independent of MongoDB.

Open **http://localhost:5173/register**, create an account, and use the dashboard. Registration signs you in. Refreshing restores your session. Sign out revokes the session server-side and clears private views in other tabs. An expired session redirects to login. Vite proxies relative `/api` requests to the root `PORT`; Redis/MongoDB URLs never enter the browser bundle. Development and build-preview servers remain loopback-only.

## Try real jobs

Use Submit job to upload `samples/mixed.csv`, then follow the accepted job to its details. Expected actual fixture result: **5 processed, 2 accepted, 3 rejected**. `samples/valid.csv` contains three valid rows; `samples/malformed.csv` fails permanently on syntax.

The schema is UTF-8 CSV with header `name,email,age`. Names are nonempty and at most 100 characters, email uses basic format validation and lowercase normalization, and age is integer digits from 0 to 120. Invalid rows are counted/skipped. BOM, CRLF and quoted fields are supported. Limits remain one file, 2 MB, 10,000 data rows and 16 KB per record. Browser validation is feedback; server/worker validation remains authoritative.

Upload identical bytes again **under the same account**: the same retained import/job is reused without duplicate rows. A second account uploading those bytes receives a different import ID and cannot access the first account's source, job, summary or results. Filenames do not affect deduplication. Different bytes create a new import. Duplicate emails/rows inside an input remain separate row occurrences.

Simulation submissions still run for ten seconds, update percentage progress and either complete or fail in a controlled way. CSV imports retain batches of 100, three total attempts, exponential retry backoff and idempotent writes. Nonterminal details poll every 1.5 seconds; terminal polling stops. Dashboard/history/results refresh every five seconds.

History and statistics now use a MongoDB ownership catalog plus owner-checked live BullMQ reads. They include **only your retained jobs**. The old global 500-entry-per-state inspection window is no longer used. These reads currently cost O(your job count), with bounded Redis request concurrency, and are intended for local workloads.

## Authenticated API use

Public authentication routes:

| Route | Contract |
| --- | --- |
| `POST /api/v1/auth/register` | JSON `{email,password}`; 201 with user, CSRF token, expiration and an HttpOnly cookie |
| `POST /api/v1/auth/login` | Same JSON shape; 200 with a fresh session |
| `GET /api/v1/auth/session` | Restore current user/CSRF/expiration, or 401 |
| `POST /api/v1/auth/logout` | Authenticated + CSRF-protected; 204 and session revocation |

Passwords require at least 12 Unicode characters and at most 72 UTF-8 bytes. Overlong passwords are rejected rather than silently truncated by bcrypt. Emails are normalized and uniquely indexed. Login failures use a generic message. There are no pre-created accounts or default passwords.

All job/import/statistics APIs require the session cookie. State-changing requests also require `X-JobPulse-Request: 1` and the session's `X-CSRF-Token`. Login/registration require the request marker and validate Origin when present. Browser requests must come from `APP_ORIGIN` (or the configured local API origin). No permissive CORS is enabled. Missing Origin is allowed for explicit non-browser clients with the required headers.

Example PowerShell login after creating your account in the UI:

```powershell
$credentials = Get-Credential -Message 'JobPulse email and password'
$body = @{ email = $credentials.UserName; password = $credentials.GetNetworkCredential().Password } | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/v1/auth/login -ContentType application/json -Headers @{ 'X-JobPulse-Request' = '1' } -Body $body -SessionVariable jobpulseCookies
$headers = @{ 'X-JobPulse-Request' = '1'; 'X-CSRF-Token' = $session.csrfToken }
$job = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/v1/jobs -WebSession $jobpulseCookies -Headers $headers -ContentType application/json -Body '{"type":"simulation","mode":"complete"}'
Invoke-RestMethod ("http://127.0.0.1:3000" + $job.statusUrl) -WebSession $jobpulseCookies
```

For CLI CSV upload using that same in-memory session:

```powershell
$cookie = $jobpulseCookies.Cookies.GetCookieHeader([uri]'http://127.0.0.1:3000/api/v1/imports')
curl.exe --cookie $cookie -H "X-JobPulse-Request: 1" -H "X-CSRF-Token: $($session.csrfToken)" -F "file=@samples/mixed.csv;type=text/csv" http://127.0.0.1:3000/api/v1/imports
```

Do not print/store cookie values or passwords in source files. Bare unauthenticated curl requests from earlier milestones now return 401. Foreign and unknown resources both return 404 after authentication. Owner/user IDs supplied by clients never grant access.

## Security and legacy data

Sessions have 256-bit random opaque IDs. MongoDB stores only their SHA-256 hashes, user IDs, CSRF values and fixed expiry times. Expiry is checked on every request, independently of MongoDB TTL cleanup. Cookies use HttpOnly, SameSite=Strict, a host-only scope and Path=/api. CSRF values live only in React memory; there are no auth tokens in localStorage or sessionStorage. Login/registration rotate the submitted session, and logout invalidates it in MongoDB.

Passwords use bcrypt cost 12. Auth input validation rejects operator objects, oversized input and unexpected ownership fields. Rate limits are per API process: registration 20/IP/15 min, login 40/IP/15 min plus 10/IP+email/15 min, session restoration 150/IP/min, private API 300/user/min, and uploads 10/user/min. Summary polling uses the read limit, not the upload limit. No proxy IP headers are trusted.

Existing unowned jobs/imports/records remain stored and inaccessible through all private APIs. They are not assigned to the first registered user. Workers can finish trusted legacy jobs, but no user can claim them. Re-upload a CSV under your own account for a new scoped import; no automatic data migration or deletion runs.

Local assumptions: trust the machine, Redis, MongoDB and worker processes. Databases retain loopback-only host ports and have no new database authentication configuration. A local database/container administrator can bypass application authorization. HTTP cookie transport and same-host browser applications are not strong isolation boundaries against a compromised local process. This is not a public-production deployment.

No email verification, password reset, MFA, account deletion, admin resource-sharing, breach-password lookup or production security certification is included. Registration's duplicate-email status can reveal email availability. In-memory rate limits reset with an API restart and are not shared across API replicas. Sessions themselves are durable/shared in MongoDB. A stolen valid bearer cookie remains usable until logout/expiry; HttpOnly and CSRF defenses do not make arbitrary same-origin script execution safe.

## Tests and build

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run test:integration
npm.cmd run test:web
npm.cmd run build:web
```

Integration tests require Redis/MongoDB and use unique test namespaces. They cover two-user isolation, owned and legacy job behavior, actual hashing/session persistence, expiry/tampering/CSRF, private metrics/history, simulations, batch writes, retries and duplicate prevention. Worker tests use real independent processes. No existing container is restarted, flushed or deleted.

Browser tests require installed Google Chrome and free test ports **3001 and 5174**. They start the real app/handlers on isolated queues/databases without stopping existing development processes on 3000/5173. They create real test accounts and jobs, exercise registration/login/restore/logout and two-user CSV isolation, retain existing flows, and check accessibility/mobile behavior. Only owned test processes are stopped. Generated artifacts are ignored.

For local production-build preview: `npm.cmd run build:web`, then `npm.cmd --prefix web run preview` while the API and workers run separately. There is no deployment step.

## Remaining processing limits

MongoDB persistence and Redis enqueue are still separate writes, with no automatic outbox recovery. Imports are not all-or-nothing: committed batches remain after failure and can be safely replayed. Sources/jobs/ownership metadata are retained indefinitely. Re-uploading a terminal failed import does not reset attempts. There is no manual retry or file-download endpoint. Single Redis/MongoDB instances provide persistence, not high availability or zero-loss guarantees.

See [authentication architecture](docs/authentication.md) for the security model, [CSV implementation](docs/csv-imports.md) for processing foundations, and [frontend architecture](docs/frontend.md) for UI components. Older milestone documents include historical behavior; authentication/ownership changes here and in the authentication document take precedence.

Exact check outcomes, test coverage and intermediate corrections are recorded in [authentication verification](docs/auth-verification.md).

### If the registration page reports an unavailable account service

`GET /api/v1/auth/session` should return **401** before login, not 404. A 404 `Route not found` from both port 3000 and Vite's `/api` proxy means the listening API has not loaded the auth routes. Restart that API with the current checkout; use `npm.cmd run dev` during backend development for automatic reloads. Keep `PORT` consistent with the Vite proxy. Do not remove the restoration request or treat a missing route as a successful/anonymous session. The UI keeps this failure visible with a retry action and distinguishes it from a missing job. MongoDB, cookie and session details belong in this README and the authentication document, rather than the sign-in screens.

### Dashboard presentation

The interface focuses on jobs, statuses, processed rows and outcomes. Hosting badges, architecture explanations and implementation footers are omitted. Queue metrics still describe the authenticated user's retained jobs, not lifetime totals or worker availability; those semantics remain documented here rather than repeated below every table. The CSV progress bar is an accepted/rejected breakdown of processed rows, not an estimated percentage of the whole file. Completed summaries use the existing result fields; no measurements are invented. Retry delay, partial saved rows, upload limits, validation and uncertain-submission recovery remain visible when useful. Technical startup, database, session, polling and recovery details remain in this README and `docs/`.
