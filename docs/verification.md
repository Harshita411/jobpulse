# Local verification record

Recorded during this implementation session on 2026-11-05. These are test outcomes, not throughput or production-reliability benchmarks.

## Final checks

| Command | Outcome |
| --- | --- |
| `npm.cmd test` | Exit 0: 18 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm.cmd run test:integration` | Exit 0: 7 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm.cmd run check` | Exit 0: syntax checks passed for source, tests and scripts |
| `docker compose config --quiet` | Exit 0 |
| `npm.cmd audit --json --cache .npm-cache` | Exit 0: 0 reported vulnerabilities |
| `git diff --check` | Exit 0; repository additions are untracked, so this does not inspect all newly created file content |

Integration coverage uses real HTTP, Redis and MongoDB, plus two independent Node worker processes. It covers simulation compatibility, concurrent identical uploads, compound unique-index enforcement, increasing retry delays, retry exhaustion, permanent syntax failure, and concurrent replay of 205 records. Deliberately injected lost acknowledgements happen after real MongoDB writes; they do not represent actual observed MongoDB outages.

## Intermediate failures and resolution

- Dependency installation initially failed with sandbox network `EACCES`. An approved installation outside the sandbox succeeded.
- The initial CSV parser version had one moderate advisory (`GHSA-8cw4-87c7-c6xx`). It was replaced with `csv-parse@7.0.3`; the final online audit above reports zero advisories.
- The first full integration run passed all 7 tests. A later repeat failed after roughly 43 minutes elapsed: its summary reported 0 passed, 4 failed and 3 cancelled, including Redis `Command timed out` and exceeded test deadlines. Read-only checks subsequently returned Redis `PONG` and MongoDB ping success. A fresh run passed all 7 tests. No container restart, database reset or timeout increase was used; the precise environmental cause was not established.

## Containers

Only `docker compose up -d --no-deps mongodb` was used to add a service. Final read-only checks showed:

- `jobpulse-mongodb-1`: healthy, `127.0.0.1:27018`.
- `jobpulse-redis-1`: healthy, still running on `127.0.0.1:6380`.
- Existing `monlay_postgres` and `monlay_redis`: still running on their original host ports 5433 and 6379.

No existing container was stopped/recreated, no volume was deleted, and no application database was dropped or flushed. Test cleanup targets only fixtures in unique test queue/database namespaces. Services remain running for local use.
