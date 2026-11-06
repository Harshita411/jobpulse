# JobPulse

A locally runnable background-job processing portfolio project using Node.js, Express, BullMQ, Redis, MongoDB Community Edition and a React operations dashboard. Supports real CSV imports and the original ten-second simulation jobs. No hosting, cloud accounts, paid APIs or public deployment are needed.

## Setup

Use Node.js 24 (or 22.12+ for Vite), npm and a running Docker Compose engine. These examples use PowerShell; use `npm` and `cp` on macOS/Linux.

```powershell
npm.cmd ci
npm.cmd --prefix web ci
# Only if .env does not already exist:
Copy-Item .env.example .env
```

Configuration (existing process environment variables take precedence over root `.env`):

```dotenv
PORT=3000
REDIS_URL=redis://127.0.0.1:6380
MONGODB_URL=mongodb://127.0.0.1:27018/jobpulse
```

All API, worker and integration-test npm scripts load the root `.env`. `REDIS_URL` is required. `MONGODB_URL` defaults to the local URL above; MongoDB connections are lazy so existing simulations still work without it. API port defaults to 3000.

For a fresh setup:

```powershell
docker compose up -d redis mongodb
docker compose ps
```

If JobPulse Redis is already running, add only MongoDB:

```powershell
docker compose up -d --no-deps mongodb
```

Redis publishes on **127.0.0.1:6380**, MongoDB on **127.0.0.1:27018**. Internal ports remain 6379/27017. If 27018 is occupied, change the MongoDB host mapping and `MONGODB_URL` rather than stopping another container. Named volumes preserve data across normal container replacement. No reset/volume deletion is needed.

Run these in separate terminals:

```powershell
# Terminal 1
npm.cmd start
# Terminal 2
npm.cmd run worker
# Terminal 3: React dashboard at http://localhost:5173
npm.cmd run web
# Terminal 4 (optional second independent worker)
npm.cmd run worker
```

Each worker has concurrency 1 and logs its process ID when claiming work. The API never starts a worker. Ctrl+C drains active work before shutdown. `npm.cmd run dev` watches only the API.

Open **http://localhost:5173**. React/Vite proxies relative `/api` requests to Express on **localhost:3000** using the existing root `PORT` setting. Redis stays on **6380** and MongoDB on **27018**. Restart any API/worker processes started before the current code was added: older APIs lack the read routes, and simulation-only workers can claim and reject CSV jobs. Stop only your owned API/worker terminals with Ctrl+C, then start them with the commands above. No container restart is necessary. Vite fails if port 5173 is busy instead of silently selecting another port.

The dashboard shows actual retained queue counts and recent jobs. Submit CSV/simulation work, inspect history using server filters/search/pagination, follow live details, and browse completed summaries under Results. There are no fabricated metrics, unsupported downloads, or manual retry buttons. Nonterminal details poll every 1.5 seconds; dashboard/history/results refresh every 5 seconds. Terminal job and import polling stops.

## CSV demo

```powershell
curl.exe -i -F "file=@samples/mixed.csv;type=text/csv" http://127.0.0.1:3000/api/v1/imports
```

Use `curl` on macOS/Linux. The multipart field must be `file`. HTTP 202 and a `Location` header are returned after source persistence and acknowledged enqueue:

```json
{"jobId":"<64-character-hash>","importId":"<same-hash>","status":"accepted","statusUrl":"/api/v1/jobs/<same-hash>"}
```

Replace IMPORT_ID with the actual response value:

```powershell
curl.exe http://127.0.0.1:3000/api/v1/jobs/IMPORT_ID
curl.exe http://127.0.0.1:3000/api/v1/imports/IMPORT_ID
docker compose exec mongodb mongosh jobpulse --quiet --eval 'db.records.find({}, {_id: 0}).limit(10).toArray()'
```

The job endpoint shows BullMQ state, attempts made, progress and result/sanitized error. CSV progress is `{processed, accepted, rejected}`; simulation progress stays 0–100. The import endpoint reads durable MongoDB counters without source bytes. Its `finished` flag means processing reached the end, not that MongoDB and BullMQ completed atomically.

| Sample | Expected fixture outcome (not a benchmark) |
| --- | --- |
| `samples/valid.csv` | 3 processed, 3 accepted, 0 rejected |
| `samples/mixed.csv` | 5 processed, 2 accepted, 3 rejected |
| `samples/malformed.csv` | Permanent syntax failure: unterminated quote |

Upload identical bytes twice: they share one stable import ID and retained queue job, and create no extra records. Filename does not affect identity. Even a newline change creates a new import. Repeated rows/emails within a file remain separate row occurrences.

The exact header is `name,email,age`. Names must be nonempty, at most 100 characters and contain no control characters. Email uses basic `local@domain.suffix` validation (254 characters maximum) and is saved lowercase; this does not verify delivery. Age must contain integer digits from 0 to 120. Invalid rows are rejected and counted while valid rows continue. BOM, CRLF and quoted fields are supported; blank lines are ignored and surrounding whitespace trimmed.

Uploads allow one CSV file, no extra fields, a `.csv` extension and CSV MIME type (`text/csv`, `application/csv`, `application/vnd.ms-excel`). Limits: **2 MB/file**, four admitted uploads per API process, a 15-second request-body timeout, **16 KB/CSV record** and **10,000 data rows**. UTF-8/NUL checks reject obvious binary input; actual CSV/schema validation runs in the worker. Files are never executed or served publicly. Filenames never become filesystem paths.

HTTP errors: 400 for invalid input/upload/ID, 404 for missing jobs/imports, 413 for oversized files (or simulation JSON over 2 KB), 429 for upload admission limits, and 503 for dependency failures. Malformed CSV can receive 202 and fail asynchronously; invalid individual rows are rejections rather than whole-job failures.

## Original simulation demo

```powershell
$job = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/v1/jobs -ContentType application/json -Body '{"type":"simulation","mode":"complete"}'
Invoke-RestMethod ("http://127.0.0.1:3000" + $job.statusUrl) | ConvertTo-Json -Depth 5
```

Use `mode: "fail"` for controlled failure after ten seconds. Simulation jobs retain UUID identifiers, percentage progress and one execution attempt. Requests cannot supply executable code, handler paths or retry settings.

## Tests

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build:web
docker compose config --quiet
# Requires local Redis and MongoDB:
npm.cmd run test:integration
# Requires local services, installed Google Chrome and free ports 3001/5173:
npm.cmd run test:web
```

Default tests need no services. They cover API contracts, simulation behavior, upload limits/type checks, UTF-8/CSV validation, batching, counts, permanent errors and partial-write recovery.

Integration tests use real HTTP, Redis and MongoDB with isolated queue/database names. They spawn **two independent Node worker processes**, preserve simulations, upload duplicate content concurrently, verify the actual MongoDB unique index, replay 205 rows concurrently, and verify retry/backoff/exhaustion. Test-only fault injection models lost acknowledgements after real writes. No injection flag exists in the application worker/API, and no benchmark results are fabricated.

Cleanup removes only that run's fixtures. Tests never flush Redis, drop databases, stop containers or delete application volumes. Empty test databases/indexes and queue metadata keys may remain.

Browser tests start the real Express app on port **3001**, Vite on **5173**, and a worker using production handlers on a unique real queue/database namespace. This isolates them from pre-existing API/worker processes without stopping those processes. They exercise real uploads, simulation success/failure, history, results, mobile navigation, unavailable-API feedback, and automated WCAG A/AA checks on all five pages. Actual test records remain inspectable in their `jobpulse_browser_*` namespaces. Only processes started by the browser runner are stopped. Chrome is used from the machine; no cloud browser or paid service is required. The test runner requires 3001 and 5173 to be free.

For a local production-build preview (not public deployment), run `npm.cmd run build:web`, then `npm.cmd --prefix web run preview`. Keep Express and a worker running in separate terminals. Preview uses the same loopback-only API proxy and port 5173.

See [CSV architecture, functions and limitations](docs/csv-imports.md) for the design and failure model. The original documents in `docs/` include future proposals, not all implemented features.

See [frontend architecture and API contracts](docs/frontend.md) for components, data flow, read endpoints and bounded-history limitations.

Exact frontend milestone check outcomes and corrected intermediate failures are recorded in [frontend verification](docs/frontend-verification.md).
