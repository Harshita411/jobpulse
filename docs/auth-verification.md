# Authentication verification — 2026-11-06

## Final outcomes

| Command | Outcome |
| --- | --- |
| `npm.cmd test` | Exit 0: 29 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm.cmd run test:integration` | Exit 0: 14 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm.cmd run test:web` | Exit 0: all 9 browser tests passed |
| `npm.cmd run check` | Exit 0: source/test/script syntax checks passed |
| `npm.cmd run build:web` | Exit 0: production build succeeded |
| `npm.cmd audit --json --cache .npm-cache` | Exit 0: 0 reported vulnerabilities |
| `npm.cmd --prefix web audit --json --cache .npm-cache` | Exit 0: 0 reported vulnerabilities |
| `git diff --check` | Exit 0; Git printed expected LF-to-CRLF working-copy warnings |

## Security coverage

- Registration, normalization, bcrypt verification and hashed session persistence.
- HttpOnly/SameSite cookie flags, bounded expiry, session rotation and revocation.
- Generic wrong/unknown credentials, forged/duplicate session cookies and expired sessions.
- Fail-closed authentication for a malformed legacy user without a password hash.
- Missing authentication on every private resource category; ownership and CSRF/origin rejection.
- Two real users uploading identical CSV bytes: separate scoped IDs, sources and records; same-account deduplication still works.
- Foreign job/details/results/import-summary access returns 404; anonymous access returns 401. No source download route exists.
- Per-user statistics/history exclude foreign and unowned legacy jobs, including simulation ownership.
- Rate limiting and a regression proving summary GET polling is not charged to the upload POST limit.
- Existing real ten-second simulations, CSV batching/rejections, exponential retries, partial-write replay, unique constraints and independent worker processes.
- Browser registration/login, reload restoration, cross-tab logout, private-route redirects and tampered-cookie rejection.
- Browser end-to-end real CSV result of 5 processed / 2 accepted / 3 rejected, plus the existing history/results/mobile/accessibility checks and accessible authentication forms.

Sessions were expired directly in the unique test MongoDB namespace while cookies were still present. This verifies server-side expiration independently of browser cookie removal and MongoDB's delayed TTL cleanup. The backend deliberately uses opaque sessions, so tampering tests target the session cookie rather than JWT signatures.

## Intermediate issues and corrections

- Dependency downloads initially hit sandbox network EACCES; approved installation succeeded, with no reported advisories.
- An early unit fixture accidentally treated its intended legacy job as owned because a default argument was applied. The fixture was corrected; application ownership checks were not bypassed.
- An early invalid-CSRF test tried an emoji HTTP header, which Node's HTTP client rejected before sending. It now uses a sendable invalid non-ASCII value and verifies server rejection.
- Browser startup found the user's existing frontend on 5173. Test-only Vite now runs on 5174 and its configured trusted origin matches that port. Normal development remains 5173, and no existing frontend was stopped.
- Review found the upload limiter initially wrapped summary GET as well as POST. It now applies only to upload POST; a real-service regression verifies repeated summary polling.
- Review added an explicit password-hash-present guard so dummy comparison work can never authenticate a malformed placeholder user. The added regression passes.

## Local-only boundaries

All live tests used the existing local Redis/MongoDB services with isolated queue/database namespaces. No Compose settings, existing containers, volumes or user data were reset. Browser tests start/stop only their own API/worker/Vite processes; test data remains in its isolated namespaces for inspection. No paid service or remote browser was used.

Already running pre-change API/worker processes were not replaced. They must be restarted by the user before relying on the new authentication boundary: an old API still executes its old unauthenticated code, and an old CSV worker does not understand scoped IDs. Runtime database administrator access remains outside application authorization. Full assumptions and remaining limits are in [authentication architecture](authentication.md).
