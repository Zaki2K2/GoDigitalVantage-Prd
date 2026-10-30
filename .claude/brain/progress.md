# Progress
## Done
- M0 foundation: Angular 20 app, Express API (env validation, helmet/cors/cookies, error envelope, /health, Mongoose).
- M0 M-AUTH: User + RefreshToken models; register/login/refresh/logout/me/csrf; httpOnly cookies, CSRF double-submit, refresh rotation + reuse detection, scrypt, Zod, login/register rate limits; `requireAuth`, deny-by-default `requireBusinessAccess` seam. Angular login/register pages, AuthService, guards, interceptor, session restore. Root ESLint (typescript-eslint + angular-eslint) + Prettier.
- Verified: api typecheck/build, 23 vitest tests vs real Mongo (`gdv_test`); web build + 12 Karma specs; eslint + prettier clean; manual browser flow (guard redirect, login, reload restore, logout) through the dev proxy against real API/Mongo.
- M1 M-BIZ: Business + BusinessMembership models, create (idempotent)/list/get/patch + onboarding progress endpoints, real `requireBusinessAccess` membership check; Angular onboarding wizard (4 steps, resumes after refresh), profile view/edit.
- M0 cleanup: Angular CSRF-header specs (POST/PUT/PATCH/DELETE), refresh multi-tab race handling, lockfile fix (`npm ci` verified).
- M2 (M-FORM, M-QR, view-only M-PUB): questionnaire models/endpoints/builder, versions, publish concurrency, QR (SVG/PNG/print/copy), public `/r/:slug`, server-verified onboarding finish, dashboard shell. M1 verified in a real browser (scratchpad puppeteer-core + system Chrome; not a project dependency). Refresh grace window hardened (access token only).
- M2 final verification (2026-10-16): clean `npm ci` in apps/api (lock has 3 win32 rolldown bindings); API tsc OK, vitest 63/63 (5 files, 0 failed/skipped); Angular 54/54; eslint + prettier clean; `npm run build` OK; real Chrome (puppeteer-core) E2E 34 checks: all real behaviors passed; 2 script flags (QR image, copy) re-checked separately: QR image 1024px loaded, clipboard write denied by headless Chrome (fallback message shown). No new defects found.
- M3 (M-RESP, M-CRM, M-CONSENT capture, qr_events, M-DASH, interactive M-PUB): see api-map/frontend-map/decisions. Results: see `Verified (M3)` below.
- Verified (M3, 2026-10-16): API tsc OK, vitest 94/94 (6 files; 31 new in `submission.test.ts`: all 5 question types + validation, anonymous/identified, idempotency + concurrency, contact dedupe/cross-tenant, consent, version history, honeypot, rate limit, scans, responses/contacts API, dashboard accuracy); Angular 73/73 (19 new); eslint, prettier, `npm run build` clean (no warnings); real Chrome (puppeteer-core) E2E 35/35 checks (owner onboarding → anonymous 375px customer submit → owner dashboard/responses/contacts). Lockfile regenerated once (rolldown bindings had dropped again; 3 entries, `npm ci` OK). Dev DB test data removed (earlier cleanups matched the wrong field: users use `emailLowercase`).
- Debug + design pass (2026-10-16): global design tokens/base typography/skeleton in `apps/web/src/styles.scss`; sticky pill-nav shell; fixed global `.row` vs editor `.row` class collision (global list class is now `.list-row`); mobile toolbar layout; dashboard loading skeleton; page title. API 94/94, web 73/73, lint/prettier/build clean, Chrome E2E (m3) 33 pass/0 fail.
- Rewards (customer recovery & promo rewards): see api-map/frontend-map/decisions. Verified: API 131/131 vitest (32 in `rewards.test.ts`), Angular 95/95, real Chrome journey 29/29 (rules from template, customer thank-you card, signed reward link, tamper rejection, cooldown denial, staff verify + min-spend + redeem, already-redeemed, disable rule, approval queue + approve, complaints log, overview, 375px overflow, no console errors).
## Next
- M4 messaging (needs Redis/BullMQ): review-request SMS (mock adapter, never fake delivery) gated on `contacts.consent.reviewRequestSms`, consent withdrawal/STOP + suppression, `sms_messages`, webhooks, dashboard SMS cards. Then M5 (calls, campaigns, billing), M6 hardening (`trust proxy`, shared rate-limit store, CSV export, text index).
- Deferred: password reset, email verification, logo upload, shared rate-limit store for multi-instance, `trust proxy`, CSV export, responses text index.
## Blockers / notes
- Redis not installed (needed at M4). SRS PDF not on disk. Port 3000 is taken by another project; this API uses 3100.
- Angular specs that assert the XSRF header must provide a real `PlatformLocation.href` (TestBed mock origin is opaque) — see `core/auth/csrf.spec.ts`.
- Browser checks use scratchpad `puppeteer-core` + installed Chrome (the Chrome extension was unavailable). Not verifiable there: clipboard write succeeding (headless denies permission; fallback message verified), real print output (print CSS verified via media emulation), real phones (375px viewport emulation only).
## Handoff
API: `npm run api:dev` (:3100); web: `npm run web:dev`. Lint `npm run lint`, format `npm run format:check` (root). After each phase update this file + touched brain entries.

## Premium UX and local-network pass (2026-10-16)

- Product plan: [docs/product-plan.md](../../docs/product-plan.md) inventories existing capabilities and prioritizes owner, staff, and customer needs from MVP through advanced modules. No reference website/video analysis or source SRS PDF was present; the supplied requirements and existing implementation guided the work.
- Shared UI: Bootstrap 5.3.8 Sass subset, Bootstrap Icons 1.13.1 local SVG sprite, Outfit Variable 5.3.0 bundled font, navy/emerald design tokens, responsive shell, and consistent state styling. Existing TailAdmin-derived utilities were retained; no new third-party admin template was imported. Light/dark/system preferences update Bootstrap and existing dark styles together.
- Pages: authentication and onboarding presentation, dashboard, questionnaire builder/preview, public form, QR, responses/contacts, business profile, and new settings route share the visual foundations. Settings implements appearance selection and actual read-only account data; messaging/AI/incidents/locations/billing are explicitly planned. Business selection is saved per user in the browser and applied consistently across existing views; API tenant authorization is unchanged.
- Assets: local 109 KB coffee WebP (Unsplash license), original feedback SVG, local icons/fonts, and bundled license notices in `apps/web/public/assets/`. No runtime remote image/font dependencies. No additional API dependencies.
- QR/LAN: preferred `PUBLIC_APP_BASE_URL` with legacy `PUBLIC_BASE_URL` fallback; validated HTTP(S) URL; four-module QR quiet zone; Angular `start:lan` binding; relative same-origin API proxy to :3100. Browser request IDs use `crypto.getRandomValues` so questionnaire edits, onboarding, and public submissions work on ordinary HTTP LAN origins. [Local setup and phone testing](../../docs/local-development.md) covers local MongoDB, CORS, firewall/network troubleshooting, stable URLs, and offline limitations.
- Verified so far: API build/typecheck, 99/99 integration tests across 8 files, API lint and touched-file formatting. Environment validation, CORS allowlist, and LAN PNG/SVG QR coverage added. Angular production build passes; initial JS/CSS approximately 441 KB raw / 106 KB estimated transfer, within its 500 KB warning budget.
- Final browser journey, Angular test totals, whole-repository lint/format, and disconnected-external-network checks are pending in this entry; historical M2/M3 results above are not evidence for this pass. No physical phone scan has yet been verified.
- Next priorities: finish current verification, then account recovery, safe CSV export, and staff invitation/assignment/inbox design. Staff incidents, replies, notification delivery/preferences, locations, AI prompts, benchmarks, SMS, and billing remain future work.

## M-ADMIN
Implemented platform administration; see [admin](admin.md) for access provisioning, routes, security decisions, schema/index changes and limits. Source: API `modules/admin/*`, web `features/admin/*`, shared `record-details.ts`. Reuses AppShell, business editor and questionnaire preview. Existing tenant membership remains mandatory even for SUPER_ADMIN on normal business endpoints. Account/session checks now apply immediately to private requests. Moderation blocks member access and public forms. No production environment changes or automatic privilege grants.

- Fixed Super Admin landing redirects: root, guest pages and onboarding deep links now resolve to `/admin`; stale login return URLs cannot trigger business onboarding. Added routing/login regression coverage; normal tenant onboarding remains enforced.

- Refined shared admin tables: compact headers/rows, owner/email hierarchy, combined business status badges, aligned counts/dates and inline actions. Floating row menus no longer expand table rows; keyboard/focus and confirmation regression tests added.

- Fixed business-detail Actions dropdown layering: its toolbar now has an explicit elevated stacking context, keeping the dropdown above later isolated detail cards.

- Fixed admin action gaps: added platform/business role changes, block/unblock aliases, other-admin management with self-lockout protection, and membership removal/role/status controls from both UI entry points. Versioned access/refresh revocation rejects old and racing refresh sessions. Serialized audited mutations preserve last owner and active admin under concurrency; legacy disabled businesses reactivate without bypassing onboarding.

- Verification: final full API suite 168/168 across 13 files and ChromeHeadless suite 131/131. Both production builds, API typecheck, lint, formatting and diff whitespace checks passed. All test mutations use gdv_test, not application/production data.

- Reworked the Super Admin dashboard presentation with four primary totals, business-health progress, feedback rating and empty state, contextual access restrictions, and grouped forms/customer/reward metrics. AdminDashboard reuses existing cards, icons, colors and API data. Dashboard rendering/filter links and zero-data calculations are covered by tests.

## Shared email provider (2026-10-19)

Shared Resend module/spec/templates and fail-closed gates implemented for mail.godigitalvantage.com. Domain read-only status: not_started, not verified. Local non-secret sender settings updated with EMAIL_ENABLED=false; secret values unchanged. Production/DNS/provider resources untouched. Verification results recorded in docs/email-resend.md.

## Restricted email testing

Added EMAIL_TEST_MODE=false, optional RESEND_TEST_EMAIL and configurable approved test sender. Targeted provider/reward regression 43 passed; blocked sends never reach Resend or grant delivery/verification/claim state. No Vercel/deployment/secret/UI/auth changes. Exact opt-in API variables documented in docs/email-resend.md.

Restricted test-mode validation: full API suite 214/214 passed (17 files, `--testTimeout=20000`); targeted email/reward suite 43/43. API typecheck, both production builds, lint and formatting passed. No real email submission, deployment, Vercel setting or secret change was performed.

## Deployment readiness review

43 targeted provider/reward tests, API typecheck and both production builds passed. Configured API host: go-digital-vantage-api-roan.vercel.app (frontend rewrite). Direct health recovered from 503 to 200; live shared webhook returns 403 CSRF_INVALID rather than the local signature-handler 401. Deployed revision/routing must be confirmed before approved email testing. No secrets/settings/deployments/emails changed. Checklist and two-email full-verification E2E plan: docs/resend-deployment-checklist.md.

## QA audit (2026-10-19, partial)

See [docs/qa/full-system-audit.md](../../docs/qa/full-system-audit.md). `BusinessApi.list()` now shares one request per user (3 s reuse, cleared on mutations); spec added and run (web 150/150; API 214/214; lint, prettier, build, typecheck pass; browser shows 1 request per load). Production API runs in iad1 while traffic enters at sin1 (no `regions` in `apps/api/vercel.json`); region change waits on the Atlas region. The earlier "webhook returns 403 CSRF_INVALID" note is stale: production returns 401 INVALID_WEBHOOK_SIGNATURE.

Follow-up (2026-10-19): local verification recorded in the audit doc. Open: Atlas region and Vercel logs (503 root cause), production Super Admin/reward runtime checks, approved email test. Nothing pushed or deployed.

## M-CAMP � Campaign Management Engine (2026-10-20)

Implemented the shared tenant-scoped campaign domain, validated draft CRUD/revision/lifecycle APIs, owner/member permissions, Super Admin platform campaigns/global configuration templates and selected/all-business draft assignment. Existing shell/styles, forms/dialogs/tables, CRM reads, audit activity, discount rewards/atomic redemption and guarded email/receipt infrastructure are reused. See [campaigns](campaigns.md) for the audit, models, API contracts, execution flow, decisions and operational requirements.

Business and platform screens share a six-step builder, built-in/global templates, searchable paginated business/contact selection, fresh audience estimates and explicit activation confirmation (large audience notice >=500). Existing Contacts drawer supports owner-managed birthday/anniversary/tags/segment/loyalty metadata. Listing/detail show real send/redemption metrics, execution history, recipient errors and provider delivery receipts. No opens/clicks/claims/revenue metrics are invented.

Backend worker supports once/daily/weekday/weekend/monthly/yearly/birthday/anniversary/welcome/inactive rules, local timezone windows, segmentation, annual/window duplicate prevention, bounded cursor batches, offer caps, immutable provider payloads, partial retries, expired/deleted recipients/rewards and live business/creator authority checks. Durable locks fail closed on interrupted unknown operations. The index migration has a temporary uniqueness guard, explicit target-database verification and restartable behavior. No migration was run on application/production data.

Final verification:

- API: **240/240 tests, 18 files**, full suite (`npm --prefix apps/api test -- --testTimeout=20000`); **26 new campaign tests**.
- Web: **157/157 ChromeHeadless tests**, full suite; **7 new campaign screen/picker tests**.
- `npm run build`: both production builds pass; web initial bundle approximately 460 KB raw, within existing budget; no Angular build warnings in final build.
- `npm run lint`, API typecheck (including migration script), changed-file Prettier and `git diff --check`: pass.
- Whole-repository `npm run format:check`: reports existing formatting in untouched `apps/web/src/app/core/business/business.service.ts` and `business.service.spec.ts`; preserved outside this scope. Existing non-fatal API listener/browser fixture warnings remain.

Production still requires the explicit index migration, a new CRON_SECRET, trusted scheduler calls, verified/enabled existing email configuration, and monitoring/reconciliation for interrupted operations. Source Vercel maxDuration is 60 seconds. Worker is bounded to one campaign/three emails per invocation; higher volume needs queue/dispatcher capacity. Only existing percentage/fixed discounts and email are implemented; points/free-item/custom actions, other channels, budget accounting and untracked analytics are deliberately unavailable. Email consent/unsubscribe preferences are not added and SMS consent is never treated as email consent. Full limitations and calendar/retry semantics are documented in campaigns.md.

No commits, pushes, deployment, production secrets/settings, DNS or real email sends were performed.

## Campaign production hardening (2026-10-20)

Audited existing campaign APIs, live tenant/platform authorization, draft revisions/lifecycle, serverless worker, rewards, email/webhooks and declared indexes. Hardened without redesign or new dependencies. See [campaigns](campaigns.md) and [production setup/recovery](../../docs/campaign-production.md).

Implemented explicit address-bound owner-recorded marketing consent/evidence, sticky tenant email suppression, signed scanner-safe unsubscribe confirmation and RFC 8058 POST, permanent production unsubscribe secret and actual provider headers. Initial sends and retries enforce consent/suppression; early/late bounce/complaint receipts suppress future delivery. No legacy or SMS consent is inferred as email consent; self-service opt-in/resubscribe remains outside this change.

Added exclusive/parallel offer policy, tenant issuance serialization, required actual order reference for campaign redemption, unique order/reward claims and replay/order validation. Cancellation invalidates outstanding offers; redemption rechecks cancellation/business suspension. Existing non-campaign redemption remains compatible; a real POS integration is needed to enforce externally applied discounts or authenticate order references.

Added bounded worker admission, retry backoff/next-attempt/error codes, durable scheduler heartbeat and Admin monitoring of configuration/index readiness, checks, locks, failures and retries. Production disables auto-indexing; approved migration explicitly disables it in every environment, provisions the lock collection, builds/verifies unique indexes and remains restartable. Execution fails closed for missing required indexes. No automatic lock takeover, force resend or data deduplication.

Analytics: redemption denominator is actual issued offers; targeted conversion remains separate. Failure events deduplicate per recipient across failure types. Acceptance and confirmed delivery stay separate.

Verification:

- Full API suite: **254/254**, 18 files (14 additional hardening tests, including five mocked API-to-redemption campaign journeys, consent/unsubscribe, conflicts, concurrency, DST spring/fall, leap day, cancellation/suspension, monitor/auth and actual denominators).
- Full ChromeHeadless suite: **159/159** (two additional unsubscribe/monitoring tests).
- Final migration/provider/serverless regression: **62/62**, including a missing lock collection and repeatable readiness verification.
- Both production builds, API typecheck including operator script, ESLint, changed-file Prettier and diff whitespace checks pass.
- Repository-wide formatting retains the two existing warnings in untouched core/business/business.service.ts and business.service.spec.ts. Existing non-fatal test listener/QR fixture warnings remain.

Operational blockers and exact Vercel/Resend/MongoDB steps are in the runbook: approved index migration; NODE_ENV=production; permanent MARKETING_UNSUBSCRIBE_SECRET; >=32-character CRON_SECRET; minute-capable scheduler/adequate capacity; verified sending domain/key and signed webhook; explicit contact consent; approved deployment and live verification. No live account configuration is asserted as verified. No production migrations, real email, deployments, secrets/DNS/provider changes, commits or pushes were performed.

## Campaign table layout correction (2026-10-20)

Replaced the unstyled table-wrap/plain table markup in Campaigns and execution monitoring with the existing Admin card, scroll-container, padded cells/headers, divider and light/dark table utilities. Added minimum table widths and confined horizontal scrolling; action groups have explicit spacing and desktop-only sticky positioning. No new visual system or backend changes. Added a ChromeHeadless layout regression measuring header text separation and table-contained overflow at 390px. Full browser suite: 160/160; Angular production build, scoped lint/format and diff whitespace checks pass. A separate browser preview launch was blocked by automatic tool policy, so layout verification used the existing browser harness.


## Campaign modal UI (2026-10-20)

Replaced the Campaigns listing table with responsive, aligned cards on both business/Admin routes. All normal operations remain on the listing: five-step modal builder, template preview/use, prefilled duplicate, details/analytics/history, lifecycle confirmation, global assignment and Admin execution monitoring. Reused semantic cards/fields/buttons/badges, existing theme tokens, Icon, DialogFocus, CampaignPicker, CampaignMonitoring and CampaignApi. Preserved every configuration field and existing backend/security contract; optional settings use disclosures. Added inline accessible validation, guarded unsaved close/navigation/unload/template replacement, single scrolling body, fixed builder header/footer, inert background and focus restoration.

Verification: 170/170 ChromeHeadless tests (10 additional cases covering actual UI flows, five-step create/review, edit revision/preservation, duplicate delayed creation, templates, pause/resume/cancel, unsaved state, validation/errors, focus and responsive geometry); 254/254 API tests. ESLint, API and Angular app/spec typechecks, both production builds, scoped formatting and whitespace checks pass. Repository-wide formatting still reports the two previously unformatted untouched core/business service files. Existing non-fatal browser font/fixture and API listener warnings remain. Brain campaigns entry updated. No backend changes in this UI task; no real email, production migration, deploy, commit or push.

## Shared dropdown modernization (2026-10-20)

Audited all application screens. Migrated all 28 feature selects, both BusinessForm editable datalists and four existing action-menu implementations to one shared select/menu design. Added OnPush SelectControl (CVA), native AppSelect adapters, ActionMenu and shared top-layer DropdownPanel; styling uses existing tokens in dropdowns.css. Existing numeric/native values, validators, custom category/timezone text, filters/sorting, business switching, permission conditions, consent and sensitive-action confirmations remain authoritative. No dependencies or backend changes. Kept semantic choice cards, public answer controls, chart/config disclosures and authorized paginated CampaignPicker behavior.

Full frontend suite: 187/187, including 17 new shared dropdown/browser cases (native/reactive CVAs, multi-select, search/reset, validation, async options, loading/disabled states, 2,000 options, clipped modal/Escape isolation, action callbacks, keyboard/focus and 390/768/1280px edge/long-label geometry). Existing Admin/Campaign flow tests use the visible shared triggers. Resolved an auth test's pre-existing storage-order assumption by checking login leaves existing preferences unchanged. ESLint, Angular app/spec typechecks and both API/Angular production builds pass. Changed-file formatting and whitespace checks pass; repository-wide formatting retains two existing warnings in untouched core/business/business.service.ts and business.service.spec.ts. Existing non-fatal font/fixture warnings remain.

Architecture, API, examples, migration boundaries, browser fallback and bounded initial option rendering are in dropdowns.md; frontend-map, campaigns and change-impact updated. Native fallback remains for older browsers without Popover API. No real email, database migration, commit, push or deployment.

## Performance follow-up (2026-10-20)

Reviewed the seven performance changes; added request timing diagnostics (auth/db/total, opt-in), simplified immutable-cache header patterns, health-503 analysis, region/Fluid verification and benchmark checklist in docs/performance-vercel.md. API 268 tests, web 187, lint, typecheck and both builds pass. Not committed, pushed or deployed.

## Profile image and business logo (2026-10-20)

Optional user avatar and business logo added (see database, api-map, frontend-map, change-impact). Never required by registration, onboarding or any workflow; initials fallback everywhere. Stored in MongoDB `profile_images` (no disk/object store on Vercel); client resizes before upload; server validates magic bytes and 512 KB.

Verification: API 279/279 (12 new in images.test.ts; 2 existing public-payload assertions gained `logoUrl: null`); ChromeHeadless 200/200 (13 new: Avatar fallback/load/error, ImageUpload states and client rejection, canvas resize); API and Angular app/spec typecheck, eslint and both production builds pass. Not verified in a real browser: an actual file-picker upload through the UI. No commit, push, deploy or data migration.

Follow-ups: avatars in activity history and admin member lists, cropping UI, orphan cleanup if an owner is deleted (images are tiny and keyed by owner id).

### Resend configuration recheck (2026-10-20)
Read-only provider listing succeeds with the existing local key. Required mail.godigitalvantage.com is absent; listed domains are not_started/pending. Local email disabled, webhook secret absent; deployed Vercel settings remain inaccessible. No provider/DNS/config changes or email sent. Evidence and preparation: docs/email-resend.md.

## Privacy-first Super Admin (2026-10-28, branch feat/privacy-first-super-admin, uncommitted)

Implemented default-deny customer data for Super Admin, owner-approved support grants, reauth, emergency review, append-only access log, UI restricted states. API vitest 287 passed / 6 failed (the same 6 date-dependent campaign tests that fail on main before these changes); web 201/201; lint, both builds, typecheck clean. Not committed or pushed. See [admin](admin.md).

- Hardening pass (2026-10-28): session-bound reauth, owner approval for platform campaigns plus legacy audit tooling, retention/permission tooling, browser E2E on gdv_test (41/41, isolated API :3199 / web :4299), campaign tests stabilised with a frozen Date. See [admin](admin.md).


- WhatsApp follow-up (2026-10-28): Cloud API + click-to-chat, dashboard panel in the contact drawer (`features/contacts/contact-followup.ts`), webhook, consent/STOP checks, history. API vitest 321/321, web 204/204, lint/build clean. Not committed. Real Meta delivery not exercised (no credentials here): only a stubbed `fetch` was tested. See [decisions](decisions.md).

- Manual contact add (2026-10-28): `POST /businesses/:id/contacts` (owner, `contacts:manage`) + "Add contact" form on the Contacts page. Needs email or +country-code phone; duplicates in the same business return 409 `CONTACT_EXISTS`; no consent is recorded, so follow-up and promotions stay blocked until the customer grants it.

- Follow-up review fixes (2026-10-28): WhatsApp-specific consent, template confirmation, multi-tenant webhook routing, browser-tested contact creation + click-to-chat + API send (22/22, mock Graph). Existing contacts have no WhatsApp consent, so follow-up stays off for them until they re-consent. See [decisions](decisions.md).
