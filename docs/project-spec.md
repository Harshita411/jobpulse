# JobPulse project specification

Implementation update: the current code preserves simulation jobs and adds bounded CSV imports with local MongoDB, batched idempotent writes and retry tests. See the [README](../README.md) and [CSV notes](csv-imports.md) for implemented behavior. Milestones below are the original proposal and do not imply every feature is complete.

## Status and basis

This is a proposed specification based on the supplied requirements: a distributed background job processing and monitoring platform using Node.js, Express, MongoDB, Redis, BullMQ, React, and Docker.

Repository inspection on 2026-11-03 found only `docs/JobPulse_Complete_Project_Blueprint.pdf`, with no application code, package manifests, or `AGENTS.md`. The PDF could not be extracted: the installed `pdftotext` requires unfinished MiKTeX setup, and no Python PDF extraction library is installed. **The blueprint's contents have not been verified.** Reconcile these documents with it when extraction becomes available. Features and defaults below are proposals, not confirmed blueprint requirements.

## Purpose and learning goals

JobPulse accepts work over HTTP, runs it outside the HTTP request, and lets users inspect its progress and failures. A slow task should not keep a browser request open or prevent the API from serving other users.

The central distributed-systems lesson is that the API, worker, Redis, and MongoDB can fail independently. A successful HTTP submission does not mean execution has finished. A crashed worker does not necessarily mean its work never happened.

## Proposed scope

The MVP supports one named queue (`jobpulse-jobs`) and one safe job type (`demo.report`). Given a small validated input such as `{ "label": "first-run", "count": 100 }`, the worker calculates a deterministic summary and returns a small JSON result. It performs no external side effects. A bounded input makes early failures easier to diagnose.

The eventual MVP provides:

- Job submission with input validation and documented retry behavior.
- Independent worker processes, bounded concurrency, automatic retries, and retained terminal failures.
- MongoDB job history with timestamps, result summaries, and sanitized errors.
- A React dashboard for job lists, details, queue counts, and failed-job inspection.
- Docker Compose for repeatable local operation and demonstrations of worker recovery.

Defer recurring jobs, priorities, cancellation, workflow dependencies, multiple queue routing, arbitrary user code, external email/payment integrations, and Kubernetes. These add separate correctness problems before the basic delivery model is understood. Initial operation is local and single-user; authentication and authorization are required before exposing submission, monitoring, or retry controls to untrusted users.

## API contract

All routes are proposed under `/api/v1`. The first milestone implements only `POST /jobs`.

| Route | Responsibility | Planned milestone |
| --- | --- | --- |
| `POST /jobs` | Validate a supported type and bounded payload; submit work; return a stable job ID | 1 |
| `GET /jobs/:id` | Return current execution state, history, result, and state observation time | 2 |
| `GET /jobs` | Paginated history, filtered by type/status/date | 2 |
| `GET /queues/jobpulse-jobs/metrics` | Counts by queue state and available timing measurements | 4 |
| `GET /health/live` | Indicate that the API process is running | 3 |
| `GET /health/ready` | Check dependencies needed to accept work | 3 |

Submission example:

```http
POST /api/v1/jobs
Content-Type: application/json

{"type":"demo.report","payload":{"label":"first-run","count":100}}
```

An acknowledged enqueue returns `202 Accepted` with `{ "jobId": "<uuid>", "status": "queued" }`. This is an acceptance receipt, not a claim that the job is still waiting when the client reads the response; a fast worker may already have finished. Add a `Location` header when the detail endpoint exists. Proposed errors: `400` for invalid type/payload, `404` for an unknown job, `409` for conflicting idempotency-key reuse, `503` when required infrastructure is unavailable, and `500` for unexpected server errors. Use a consistent error object with a safe message and request ID.

Initially, a lost submission response has an uncertain outcome; retrying may create a second job. Milestone 3 adds an `Idempotency-Key` header backed by a unique MongoDB index. The same key and canonical request hash return the original job ID; the same key with different input returns `409`. Document the key retention period. Do not claim exactly-once submission in milestone 1.

## State and data requirements

BullMQ in Redis owns scheduling and live execution state. MongoDB owns persistent application metadata and queryable history. MongoDB's displayed execution status is a projection: a stored copy that can temporarily lag the queue.

Proposed job document:

- `jobId` (unique UUID), `type`, `payload`, `schemaVersion`, `createdAt`.
- `dispatchStatus` (`pending` or `enqueued`) once recoverable dispatch is introduced.
- `executionStatus`, `statusObservedAt`, `startedAt`, `finishedAt`, `attemptsMade`.
- Small `result`, sanitized `lastError`, and optional unique `idempotencyKey` plus request hash.

Use separate bounded attempt-history records if needed rather than growing one document indefinitely. Index `jobId` uniquely and `(createdAt, jobId)` for stable pagination; add status indexes only for actual query needs. Keep queue payloads small: initially include the validated demo input; later use `{ jobId, schemaVersion }` and load the immutable input from MongoDB. Never put credentials into job payloads or log full sensitive input.

## Milestones and acceptance criteria

### 1. One endpoint, one queue, one independent worker

Create a Node project with separate API and worker entry points, one shared queue name/configuration module, Express, BullMQ, and Redis. Start the API and worker with separate commands. The API must not import or start the worker. Use concurrency 1, an explicit small retry policy, and retained completed/failed jobs for inspection. MongoDB and React are not needed to prove this first slice.

**Done when:** a valid POST returns `202` and a UUID; a separately running worker logs that same ID and a deterministic result; invalid input creates no queue job; stopping the worker still allows enqueueing, and restarting it processes the backlog. Verify results through BullMQ inspection and structured logs until the read API exists.

### 2. MongoDB history and read APIs

Persist the job document before enqueueing; pass its ID to the queue. Add list/detail routes, result persistence, attempt metadata, and lifecycle projection. Explicitly expose pending dispatch and stale observations rather than pretending the MongoDB and Redis writes are atomic. This milestone's submission path still has a crash gap; exercise and document it before milestone 3 closes it.

**Done when:** jobs can be found after API restarts, results are queryable, missing IDs return `404`, pagination is bounded, and history distinguishes retrying jobs from terminal failures.

### 3. Recoverable submission and failure handling

Add idempotent submission and a recoverable dispatch loop over MongoDB documents marked `pending`. Use the same stable BullMQ job ID on every dispatch attempt, guarded status updates, state reconciliation, bounded backoff, clean shutdown, and readiness checks. See `architecture.md` for the remaining duplicate-execution risks.

**Done when:** tests cover crashes between persistence and enqueue, a lost enqueue acknowledgement, repeated submission with the same key, worker death while active, transient failure followed by success, and exhausted attempts. No durable accepted job is silently abandoned in the tested recoverable cases. Redis loss has a documented recovery procedure; it is not an exactly-once guarantee.

### 4. React monitoring

Add a job table, filters, detail/attempt view, and queue summary. Start with polling (for example every 3 seconds while visible); show loading, empty, error, stale, and reconnect states. Show terminal failures separately from scheduled retries. Use the API for all access; the browser never connects to Redis or MongoDB.

**Done when:** a user can submit a demo job and observe waiting, processing, completion, and failure; timestamps make delayed history visible. Derive queue counts from BullMQ and historical counts from MongoDB, with their sources labeled.

### 5. Containerized operation and scaling demonstration

Add Dockerfiles and Compose services for API, worker, React, Redis, and MongoDB, with persistent volumes, dependency health checks, configuration examples, and graceful termination. Compose is a local deployment tool, not high availability.

**Done when:** a clean checkout can run from documented commands; two worker replicas consume the same queue; queued jobs survive a normal Redis container restart under the chosen persistence configuration; shutdown drains active work within the grace period. Run a small load exercise measuring throughput, queue age, and execution latency before increasing concurrency.

## Verification approach

Use unit tests for validation and deterministic business logic. Use integration tests with real Redis and MongoDB for queue transitions, persistence, deduplication, and crash recovery; mocks cannot demonstrate distributed failure behavior. Use one end-to-end dashboard flow after the UI exists. Record observed behavior and known gaps at each milestone rather than generating the entire application up front.

## Supporting references

BullMQ's official guides explain [workers](https://docs.bullmq.io/guide/workers), [retry behavior](https://docs.bullmq.io/guide/retrying-failing-jobs), [stalled jobs](https://docs.bullmq.io/guide/jobs/stalled), and [idempotent processing](https://docs.bullmq.io/patterns/idempotent-jobs). Package versions will be selected and pinned at implementation time.
