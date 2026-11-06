# Frontend verification — 2026-11-06

## Final outcomes

| Check | Exact outcome |
| --- | --- |
| `npm.cmd test` | Exit 0: 23 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm.cmd run test:integration` | Exit 0: 8 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm.cmd run test:web` | Exit 0: 7 passed; final run completed in 50.7 seconds |
| `npm.cmd run build:web` | Exit 0: Vite production build succeeded |
| `npm.cmd run check` | Exit 0: source, test and script syntax checks passed |
| `npm.cmd --prefix web audit --json --cache .npm-cache` | Exit 0: 0 reported vulnerabilities |
| `git diff --check` | Exit 0; additions remain untracked, so this is not a full whitespace check of new files |

Build output: `web/dist/`. Final assets were approximately 26.62 kB CSS and 301.97 kB JavaScript before compression. These are build sizes, not performance benchmarks.

## Real browser coverage

Installed Google Chrome ran locally through Playwright. Redis and MongoDB were real local services on ports 6380 and 27018. Test bootstraps used the actual Express app, production job dispatcher, CSV parser/store, and simulation handler on unique `jobpulse_browser_*` queue/database namespaces. No mock backend or fabricated dashboard records were used.

The seven browser tests covered:

1. UI CSV upload → accepted job → details → actual 5 processed / 2 accepted / 3 rejected result → Results page.
2. Server-backed history type/state filters, job-ID search and a genuine no-match empty state.
3. Ten-second simulation completion and controlled failure, with live polling.
4. Invalid file feedback and an unknown-job response.
5. An intentionally aborted queue request showing an API error rather than fabricated zero statistics.
6. Automated WCAG A/AA axe checks on all five pages, with actual completed CSV details/results.
7. Populated mobile dashboard/submission layouts at 390 pixels, no document/body horizontal overflow, navigation, Escape handling and focus restoration.

Screenshots were reviewed for desktop and mobile layouts. Accessibility automation does not replace a full manual assistive-technology review. Generated screenshots/traces are ignored under `web/test-results/`.

## Failures found and corrected

- Initial frontend dependency installation hit sandbox network `EACCES`; approved installation succeeded.
- Browser startup initially hit `EADDRINUSE` on port 3000 because an older API process was already running without the new routes. Tests now use their own port-3001 instance without stopping that process.
- Initial automated checks found low-contrast labels/status badges. Colors and small text were adjusted; all five pages now pass the automated checks.
- One shared-queue browser CSV test was claimed by an existing simulation-only worker and failed with the actual reason `Unsupported simulation job`. Tests now use isolated real queue/database namespaces. No existing worker was terminated to make a test pass. Earlier shared-queue test fixtures remain in the normal local workspace.
- A focused test command initially forwarded `--grep` incorrectly through two npm script layers and found no tests. Focused runs now use `npm.cmd --prefix web run test:e2e -- --grep ...`; normal `npm.cmd run test:web` runs the whole suite.
- Screenshot review revealed populated-table overflow that the empty-state mobile test missed. The strengthened test creates a real CSV first and checks both document/body width. Positioning the scroll region contained its visually hidden table label; the table remains horizontally scrollable within its own region and keyboard focusable.

## Local startup after this change

The existing older port-3000 API and workers were deliberately left running. Restart those processes in their owned terminals to load the current code; otherwise the API may lack read endpoints and a simulation-only worker may reject CSV jobs. No Docker container restart is needed.

```powershell
# API terminal
npm.cmd start
# Worker terminal
npm.cmd run worker
# Frontend terminal
npm.cmd run web
```

Open `http://localhost:5173`. The README includes installation, service startup and production-build preview commands. Test-owned servers/workers are stopped when tests finish; application services and pre-existing processes are not stopped.
