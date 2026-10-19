# Full-system audit — GoDigitalVantage (2026-10-19)

Status: **local verification complete (2026-10-19 follow-up); production-only items still open**. Production was inspected read-only in real Chrome (owner account, then a signed-out guest). No local app run, no test/typecheck/lint/build run: the cloud workspace could not install dependencies (`npm ci` → ENOTFOUND registry.npmjs.org) and no local project folder was connected. Nothing below is claimed as passing unless it says "observed".

## Issues

| # | Severity | Issue | Evidence | Status |
|---|---|---|---|---|
| 1 | Medium | API functions run in `iad1` (Washington) while requests enter at `sin1`; `apps/api/vercel.json` sets no `regions`. Even an unauthenticated 401 (no DB query) takes ~390–530 ms median vs ~120–150 ms for a cached static asset. | Chrome fetch timings, `x-vercel-id: sin1:sin1:sin1::iad1::…` on `/api/v1/me`, `/api/v1/businesses`, `/api/v1/health` | Confirmed. **Not fixed**: correct region depends on the Atlas cluster region (unknown here). |
| 2 | Medium | Intermittent `503` from `/api/v1/health` through the web rewrite (1 of 6 calls; `DB_UNAVAILABLE` path in `vercel.ts`). | Chrome fetch, first call 503, next five 200 | Observed; root cause unconfirmed (needs Vercel function logs / Atlas network access). Likely cold-start connect. |
| 3 | Low | `GET /api/v1/businesses` fired 3× per page load (onboarded guard + app shell + page; a 4th on rewards pages via `RewardsApi.business()`), concurrently, so each can hit a separate cold instance (observed 1.0 s, 1.1 s, 2.1 s). | Chrome network + `performance` entries on `/rewards`, `/questionnaire`, `/qr` | Fix written in `core/business/business.service.ts` + new `business.service.spec.ts`. **Not yet run.** |
| 4 | Info | Signed-in session ended mid-audit (tab landed on `/login`, `/me` 401). Cause not investigated (user sign-out vs refresh failure). | Chrome | Open. |
| 5 | Info | `.claude/brain/progress.md` ("Deployment readiness review") says the live webhook returns 403 `CSRF_INVALID`. | Production now returns `401 INVALID_WEBHOOK_SIGNATURE` on both `/api/v1/webhooks/resend` and `/api/v1/webhooks/instant-rewards/email` (unsigned, empty-body POST) | Note is stale; webhook-before-CSRF ordering is deployed. |

Not a defect: an email validation message once showed on an untouched login form; it did not reproduce on reload (browser-pane state).

## Observed working (production, owner account, read-only)
Dashboard, Rewards (recovery), My Rewards, Questionnaire, QR (PNG + SVG 1024 px load), Responses, Contacts, Settings, Business profile: HTTP 200s, no console errors, no horizontal overflow at the default desktop width. `/rewards-admin` correctly redirects a non-admin to `/my-rewards`.

## Fix for #3 (files modified)
- `apps/web/src/app/core/business/business.service.ts`: one shared in-flight request, 3 s reuse after it settles, keyed by signed-in user, failed requests never reused, cleared (`invalidate()`) after create/update/onboarding mutations; the selected-business ordering is still applied per read.
- `apps/web/src/app/core/business/business.service.spec.ts` (new, 7 cases): concurrent sharing, brief reuse, separate arrays per caller, selection without refetch, no reuse after failure, refetch on user change, refetch after mutations.
- **Tests: not executed.**

## Static review only (no tests run)
- `/api/v1/admin/*` is mounted behind `requireAuth` + `requireSuperAdmin`, which reads `platformRole`/`status` from the database on every request. Reward admin accepts `SUPER_ADMIN` or `instant_rewards:manage` (`instant-reward.auth.ts`).
- Email: the Resend routes and test-mode gates are documented in `docs/email-resend.md`; configuration not verified against the live API project (no env access).

## Not done
Super Admin UI/RBAC runtime tests, user block/unblock/revoke, Instant Rewards create/verify/claim/expire/enable/disable/revoke, Resend test-mode runtime check, tablet/mobile layouts, authenticated latency split (DB vs network), API tests, web tests, typecheck, ESLint, production builds, regression run.

## Production-only blockers / remaining risks
- Atlas cluster region needed to choose `regions` for the API project.
- Authorized Super Admin and reward-admin accounts needed; any reward creation on production needs explicit approval, as does sending any email.
- Vercel function logs needed for the 503 root cause.
- No push/deploy performed.


## Follow-up verification (local repo, branch `qa/full-system-audit-2026-10-19`)
Patch `gdv-audit.patch` (from Downloads) validated with `git apply --check`, then applied to a clean `main` (commit 1465842 was not present locally). Observed results:

| Check | Result |
|---|---|
| API typecheck (`tsc --noEmit`) | pass |
| API tests (vitest, local Mongo) | 17 files, 214/214 pass |
| Web tests (Karma, ChromeHeadless) | 150/150 pass (includes the 7 new `BusinessApi` cases) |
| ESLint | clean |
| Prettier | the two patch files were mis-formatted; fixed with `prettier --write`; now clean |
| `npm run build` (api + web) | pass |

**BusinessApi dedup review (static + test + browser):** shared request is keyed by signed-in user id; a failed request clears the entry; mutations call `invalidate()` in `finalize` (also on error); the selected-business ordering is applied per read on a copy, so callers never share a mutable array. Residual, accepted: an in-flight list that began before a mutation completes still serves its own subscribers, and reuse is bounded to 3 s. Browser (local dev, existing session): `/rewards` loads issue exactly one `GET /api/v1/businesses` (audit saw 3-4), no console errors.

**Browser (Chrome, local dev app on :4201, existing local session):** desktop dashboard, rewards, QR (both images load), questionnaire, my-rewards, public form `/r/florida-steak-house` load without console errors or horizontal overflow; unknown public form shows the "This form isn't available" state. Mobile width was measured with a 390 px same-origin iframe (window resize did not change the viewport): no horizontal overflow on `/`, rewards, QR, questionnaire, my-rewards, contacts, responses, settings, business, public form. Not exercised in the browser: login/signup submit, form submission, reward create/claim, Super Admin UI.

**Super Admin security:** covered by the passing API suites `admin.test.ts` and `admin-permissions.test.ts` (anonymous/user/owner denied on every admin section, CSRF on admin mutations, block/unblock with immediate cookie revocation and no revival of old sessions, session revoke, role changes with last-admin and self protection, concurrent lockout serialization, owner invariants, tenant mismatch, audit fail-closed) and `instant-rewards.test.ts` (admin/permission-gated reward administration). These are automated, not production, checks.

**Resend restricted test mode:** the provider tests (`email-provider.test.ts`, `instant-rewards.test.ts`) run against a mocked provider: blocked test emails never mark rewards sent/delivered/verified/claimed. No email was sent.

**DB_UNAVAILABLE / latency:** `src/db.ts` caches one connection promise per process (pool 5, 8 s server selection, no buffering, failed attempt not cached) and `vercel.ts` returns 503 only when that connect fails; code review found no defect that explains it. Live `/api/v1/health` via the production API host returned 200 on 8/8 calls (cold ~1.06 s, then 354-402 ms, all `sin1 -> iad1`). Root cause of the earlier single 503 is **unconfirmed**: Vercel CLI is not logged in (no function logs) and Atlas is not accessible, so the cluster region and network access list are unknown. No region change made. To resolve: read Vercel logs for "Database unavailable:" and check the Atlas region and that the Network Access list admits Vercel.

Note: port 4200 on this machine is occupied by an unrelated app ("CustomerCore"); it was not touched.
