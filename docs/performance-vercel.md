# Vercel performance investigation — 2026-10-20

## Scope and access

Investigated the deployed API and web origins configured in the repository:

- API: `https://go-digital-vantage-api-roan.vercel.app`
- Web: `https://go-digital-vantage-prd.vercel.app`

Only public GET requests and read-only Atlas operations were performed. No production accounts were impersonated, no cookies/credentials were exported, and no deployment, project setting, index, collection, document, or scheduler execution was changed.

Vercel CLI has no authenticated account here. Its automatic login prompt was cancelled. Function logs, actual memory/duration/Fluid settings, deployment environment variables and private endpoint timings could not be inspected. The Atlas URI in the local `.env.production` is usable for read-only probes, but is **not verified to equal the deployed URI/database**. Prior brain notes already record a deployed/local database-name discrepancy. No URI changes were made.

## Live baseline

Five requests per endpoint used one reused HTTPS connection per origin, with response bodies consumed. These numbers include this machine's network latency. A new HTTP connection is not evidence of a cold function. Repeated requests are warm candidates, not guaranteed to hit the same instance.

| Probe | Observed TTFB |
| --- | --- |
| Direct API health | First request 640 ms / 503; next four 200s 362–396 ms, median 367 ms |
| Direct API CSRF | 366–562 ms, median 370 ms |
| Direct API `/me`, anonymous | 373–519 ms, median 466 ms; all expected 401s |
| Web-proxied health | First 1,088 ms; repeats 358–704 ms |
| Web-proxied CSRF | 356–411 ms, median 365 ms |
| Web-proxied `/me`, anonymous | 355–390 ms, median 363 ms |
| Web `/login` HTML | First 378 ms; subsequent CDN hits 115–142 ms |

A separate fresh-HTTPS-process series measured health 848–1,107 ms and CSRF 942–1,509 ms TTFB. TLS/client connection reuse explains part of the difference; do not label this a Vercel cold-start penalty.

Request traces consistently include execution-region `iad1`, with ingress through `sin1`. The extra web rewrite is visible in traces, but these small samples do not prove it is a significant additional bottleneck. [Vercel header semantics](https://vercel.com/docs/headers/request-headers).

One health response reported the database down; the remaining samples recovered. Its cause cannot be proven without runtime/Atlas logs. Source inspection independently found the stale connection-promise issue below.

## Database measurements and indexes

Using a raw MongoClient against the **locally configured Atlas database**, without importing application models or performing automatic schema/index creation:

- Initial connection: 2,501 ms from this machine.
- Five established-connection pings: 114–201 ms, median 121 ms.
- Membership, business identity and tenant/date indexes exist in the inspected database.
- Nonexistent-tenant response/contact explain probes returned zero documents examined, with server execution times of 1–3 ms. This checks index-assisted empty lookups only; it does not establish performance for large real tenants, searches, aggregation counts or the deployed database.
- Campaign collections were absent in this database and the reward response index still had the older shape. Treat this as a deployment/database verification issue, not a reason to run a migration automatically.
- Public AWS/Google IP-prefix checks did not identify the Atlas primary region. No region was guessed or pinned in source.

Alternating equivalent read-only query probes demonstrate the cost of unnecessary network rounds. They use the same client/pool and preserve identifiers only in memory:

| Query shape | Before samples (ms) | Optimized samples (ms) | Medians |
| --- | --- | --- | --- |
| Membership + business checks, sequential vs concurrent | 411, 325, 400, 337, 336 | 1271, 158, 196, 174, 177 | 337 → 177 ms |
| Activity query with vs without two empty enrichment reads | 410, 320, 395, 320, 501 | 114, 295, 143, 163, 125 | 395 → 143 ms |

The first parallel sample includes opening an additional pooled connection and is slower than sequential. Warming the extra socket is a real cost, not excluded from the reported sample set. These measurements are **local-to-Atlas query probes, not production handler before/after timings**.

## Confirmed source issues and changes

1. `connectDb` already reused warm connections, but retained its resolved connection promise forever. If Mongoose subsequently disconnected, the helper could return that old promise without establishing a connection. Cache only in-flight attempts, clear after either outcome, and continue reusing `readyState === 1` connections. Regression tests cover concurrency, failure and disconnection.
2. Retain pool size 5 rather than guessing a higher production concurrency limit. Set `minPoolSize=0`, idle expiry 60 seconds and bounded connection/selection/checkout waits of 8 seconds. These are availability bounds, not measured latency improvements. No cross-request user or authorization cache was introduced. [MongoDB pool options](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/).
3. Disable Mongoose `autoCreate` as well as `autoIndex` in production, so application cold starts do not compete with implicit schema creation. Approved index/collection migration remains an explicit operator action.
4. Read live membership and business moderation independently in parallel. Return the same role/null result, and preserve account, membership and suspension checks.
5. Skip empty Admin owner/business lookups and counts on empty pages. Run independent page enrichment/counts together, and load business-detail owner/counts together. Preserve projections, pagination, filters, metrics and tenant boundaries.
6. Register the already-protected Campaign router before broad Admin middleware, removing duplicate Admin guard execution for campaign endpoints. Campaign routes still enforce their own current account/platform permissions.
7. Add opt-in `PERFORMANCE_LOGGING=true`: safe JSON `api_performance` records with static route templates, method/status, region, first-handler-invocation marker and startup/connect/application/total times, plus `authMs` (live session + membership lookups), `dbMs`/`dbOps` (summed MongoDB command round-trip time and count via driver command monitoring, durations only) and `dbState` (mongoose readyState at completion). Totals use per-request async context, so concurrent Fluid requests are not mixed. Route is the static template with any non-word path segment redacted to `:id`. Never include raw URLs/query strings, user/contact IDs, cookies, bodies, query values or connection strings. `Server-Timing` exposes only startup and connection phase durations. The first-invocation marker is not a substitute for Vercel's own start-type telemetry. Logs default off.
8. Live hashed JS/CSS responses were gzip-compressed but used `public, max-age=0, must-revalidate`; individual first asset probes took 425–629 ms. Add year-long immutable browser caching **only for root-level hashed main/polyfills/chunk/styles JS/CSS** in the web Vercel config, using plain `/chunk-:hash.js`-style patterns (no regex groups). All 58 matching files in the current build are fingerprinted root files; `index.html`, `favicon.*`, `media/*` fonts and `assets/*` do not match. The Vercel header matcher itself is not verifiable offline: check `curl -sI` after a preview deploy. HTML, APIs, unhashed files and fonts are excluded. Benefit on repeat visits remains unmeasured until an approved deployment.

## Frontend and scheduler findings

- The live initial scripts/styles total approximately 129 KB gzip in the measured response bodies. No external blocking scripts appeared in the HTML; the small inline theme script avoids a theme flash. Angular production optimization and lazy route chunks are configured. There is no evidence that a bundle rewrite is the primary data-loading problem.
- Session restore intentionally precedes protected routing. Anonymous initialization can make `/me` → CSRF → refresh requests; this is a serialized security dependency and was not bypassed. Private-page browser waterfalls remain unmeasured without an authenticated session.
- BusinessApi already shares guard/shell/page requests and reuses successful lists briefly per user. Refresh requests are already shared. These mechanisms were retained, rather than adding long-lived or tenant-unsafe response caches.
- Campaign execution is invoked only by the bearer-authenticated cron endpoint. Router/model imports do not execute campaigns. A running cron can still contend for the shared process/pool under Fluid concurrency; invocation/checkout telemetry is needed to establish that. No reward, consent, scheduling or locking behavior was changed.
- Existing Admin dashboard counts and searchable aggregation facets may still be expensive on larger data. No speculative indexes or query-semantic rewrites were performed without representative explain/production evidence.

## Required production validation and settings

No deployment has been performed, so deployed after timings are **pending**.

1. Confirm the API project's deployed `MONGODB_URI` database and Atlas primary region in Atlas → Database → cluster configuration. Do not print the URI or replace it based on the local file.
2. In Vercel → API project → Settings → Functions, select a function region near the **actual primary data source**. Current traces show `iad1`; that is not proof of a mismatch. Alternatively commit the confirmed `regions` value later. Source intentionally does not guess a region. [Region configuration](https://vercel.com/docs/functions/configuring-functions/region).
3. Verify `NODE_ENV=production`. Temporarily set `PERFORMANCE_LOGGING=true` on the API project for an approved diagnostic deployment. Keep secrets exclusively in the API project. Restore logging to false when investigation is complete.
4. Inspect Vercel → Observability / Runtime Logs → `api/index`: compare start type, region, duration, active CPU, memory, failures and outbound database spans for first and repeat authenticated requests. Filter application logs by `api_performance`. [Runtime log fields](https://vercel.com/docs/logs/runtime), [slow-function debugging](https://vercel.com/docs/functions/debug-slow-functions).
5. Verify the actual Fluid Compute setting under Settings → Functions. If disabled, evaluate enabling it in a preview first; compare latency, connection counts and CPU. Do not blindly raise memory, pool size or duration. Source already retains a 60-second duration cap. [Fluid configuration](https://vercel.com/docs/fluid-compute), [memory configuration](https://vercel.com/docs/functions/configuring-functions/memory).
6. In Atlas metrics/Query Profiler inspect connection count, CPU, throttling, slow operations and indexes on the **deployed** database. Use bounded explain probes for slow representative tenant queries. Existing campaign migration remains a separate approved operation; no destructive index synchronization.
7. After approved API/web deployment, repeat the same sample procedure and compare authenticated business/contacts/responses/Admin/Campaign endpoints, plus browser initialization waterfalls. Use Vercel start-type data to label actual cold vs warm invocations. Verify new hashed JS/CSS cache headers and browser-cache reuse, without caching HTML or private data.

## Verification

266 API tests (20 files) and 187 frontend tests pass. New regressions cover in-flight Mongo caching, retries/reconnection, pool/startup safety settings, preserved authorization outcomes, concurrent/skipped Admin enrichment and secret-free timing logs. Existing tenant, suspension, consent, scheduler, reward and authentication tests remain green. Final lint/typecheck/build results are recorded in the brain progress entry.


## Health endpoint 503 — what is and is not known

`GET /api/v1/health` returns 503 only when `mongoose.connection.readyState !== 1` after the handler's own `connectDb()`. The handler's own failure path returns a *different* body (`error.code` envelope, "Database unavailable"), so the 503 body tells the two apart:

| Body | Meaning |
| --- | --- |
| `{"data":{"status":"degraded","db":"down"}}` | `connectDb()` resolved but the connection was not ready afterwards. Matches the pre-fix stale resolved-promise defect (promise cached after a later disconnect). Fixed in source; unproven as the only cause. |
| `{"error":{...}}` 503 | Connect failed or timed out (8 s bounds): Atlas IP allowlist, cluster pause/failover, DNS or network. Needs Atlas/Vercel logs. |

Not determined: which body the one observed 503 carried. With `PERFORMANCE_LOGGING=true`, every request log now carries `dbState` and `connectMs`; a 503 with `dbState` 0/3 supports the stale-connection cause, while `Database unavailable` in runtime logs with `connectMs` near 8000 supports a connectivity cause. Also check the Atlas network access list (Vercel egress IPs are not fixed unless Secure Compute/static IPs are used) and the cluster tier (free/shared tiers pause and throttle).

## Verifying regions and Fluid Compute

1. **Atlas region:** Atlas → Database → cluster → *Configuration* (provider + region of the primary; for multi-region clusters, the highest-priority region). Record it; do not read it from the URI.
2. **Vercel function region:** API project → Settings → Functions → *Function Region*. Runtime proof: response header `x-vercel-id` (`<edge>::<function-region>::<id>`) and `VERCEL_REGION` in `api_performance` logs. Pick the Vercel region mapped to the Atlas region (e.g. AWS us-east-1 ↔ `iad1`). Current traces: `iad1`.
3. **Fluid Compute:** API project → Settings → Functions → *Fluid Compute* toggle. Runtime proof: Observability → Functions shows concurrent invocations per instance. Change it first on a preview deployment; compare latency, Atlas connection count (pool is 5 per instance) and CPU.
4. **Environment:** `NODE_ENV=production`, `PERFORMANCE_LOGGING=true` only during measurement.

## Before/after benchmark checklist

Run the same script before and after the approved deployment, from the same network, 10 requests per row after discarding the first; report median and p95 of TTFB. Use one reused HTTPS connection for warm rows and a fresh process for connection-cost rows.

- [ ] Record deployment ID, function region (`x-vercel-id`), Atlas region, Fluid on/off, date/time.
- [ ] Public: `/api/v1/health`, `/api/v1/auth/csrf`, anonymous `/api/v1/me` (direct API and via web rewrite).
- [ ] Authenticated (test account): `/me`, business list, `/businesses/:id/contacts`, `/responses`, dashboard summary; Super Admin: `/admin/dashboard`, `/admin/businesses`, `/admin/campaigns`.
- [ ] From `api_performance` logs for the authenticated rows: median `authMs`, `dbMs`, `dbOps`, `connectMs`, `totalMs`; split by `coldStart` and cross-check with Vercel start type.
- [ ] Count of 503s over the run, with `dbState` for each.
- [ ] Web: `curl -sI` a hashed `main-*.js` and `chunk-*.js` for `cache-control: ... immutable`; confirm `index.html` and `/api/*` are **not** immutable; reload in browser and confirm assets are served from disk cache.
- [ ] Browser: page-load waterfall for login → dashboard (request count, time to first API data).
- [ ] Atlas: connection count and slow-operation list during the run.
- [ ] Set `PERFORMANCE_LOGGING` back to false when done.
