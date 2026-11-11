# GDV security and production reliability audit — 30 October 2026

## Scope and revision

Read CLAUDE.md, the relevant brain entries, security/privileged-access.md, deployment, campaign, email and DNS handover documentation before implementation. The checkout started clean on main at 560e7d3. All local and fetched remote branches were searched. During the audit origin/main advanced to 8bc2de2, the existing merge of privacy-first-super-admin. Local main was fast-forwarded to that commit and the uncommitted hardening edits were reapplied, preserving the merged privacy, owner-approval and WhatsApp code. No new commit was created, pushed or deployed by this audit.

## Confirmed issues and root causes

| Finding | Cause | Resolution/status |
| --- | --- | --- |
| Development was capable of real Resend delivery | Local EMAIL_ENABLED=true, test mode absent, and a provider key shared with local production configuration | Disabled local delivery; removed production Resend credentials from development; introduced separate RESEND_DEV_API_KEY/RESEND_DEV_WEBHOOK_SECRET; development and Vercel previews require restricted recipient mode |
| Automated tests could inherit provider credentials | dotenv loaded the developer .env and test configuration did not override email/WhatsApp settings | Tests explicitly bypass dotenv, inject synthetic configuration, deny unmocked fetch and restrict database overrides to loopback /gdv_test |
| A real-looking webhook signing secret was tracked in the development example and matched both local env files | Secret copied into a template instead of a placeholder | Removed from template and rejected by fingerprint at startup; operator must replace the exposed webhook credential if used live; Git history still contains it |
| Development JWT secrets matched public example values | Copied starter secrets were accepted because validation checked length only | Startup now rejects known placeholder patterns, low-diversity signing secrets and reuse between signing purposes; existing development JWT values intentionally remain unchanged and startup is blocked until replaced |
| Other secrets were reused between local environments | Shared instant-reward signing secret and Meta app/verification secrets | Names-only audit reports reuse; no live rotation; separate development credentials and controlled rotation are required |
| Marketing unsubscribe signing used the access JWT secret as a development fallback | Fallback was accepted outside production and monitoring claimed it was configured | Removed in every environment; monitoring checks the dedicated secret only |
| Cron secret bypassed startup validation | Endpoint read process.env directly | CRON_SECRET is validated when present and the endpoint/monitoring use the validated configuration; absent secret keeps endpoint unauthorized |
| STOP suppression could be lost after a partial webhook failure | Inbound reply was stored before contact suppression, and duplicate reply handling continued past suppression on retry | Duplicate replies retry suppression using their original persisted time and $max; later explicit consent is not invalidated by the replay |
| Development/test WhatsApp settings could target Meta | Non-production graph URL was unrestricted | Outside actual production, enabled WhatsApp requires a loopback mock endpoint, checked at startup and immediately before sending; local switch disabled |
| Runtime drift | Root lacked an engine declaration/version files/CI; Vercel project defaults report 24.x while source apps require 22.x | Added root Node 22 engine, .nvmrc, .node-version and Node 22 CI; actual project settings require operator alignment |
| Vulnerable request parser | API lockfile pinned body-parser 2.3.0, affected by a compressed-request denial of service | Updated the existing transitive dependency to 2.4.0; retained all platform-specific lock entries and added production dependency audit checks to CI |

## Findings that were outdated or overstated

- WhatsApp is implemented. It was absent from the initial local main checkout, present on feat/privacy-first-super-admin, and is now merged in main. No second implementation was added.
- The campaign engine already has constant-time bearer authentication, durable campaign and business issuance locks, immutable retry payloads and provider keys, up to three attempts with 1/2-minute backoff, a 19-hour reconciliation boundary, signed unsubscribe, address-bound consent/suppression checks, required-index checks and monitoring. Those protections were retained, including owner approval for platform campaigns.
- The latest upstream campaign tests already freeze their clock. The initial stale-date failures belonged to the older local checkout; no duplicate clock workaround was retained.
- .env.production is not automatically loaded, but this is expected for Vercel runtime injection. Source files are not proof of deployed configuration.
- Vercel access is available. Production required-variable names exist. Empty values in CLI env exports are redactions for variables marked sensitive, not evidence of missing live values. Temporary exports were removed. Sensitive values remain unverified.
- The approved Resend domain now exists and a matching webhook is enabled. Earlier documentation saying the domain was absent is stale. The current read-only check still reports the domain as unverified.

## Campaign and WhatsApp verification

Campaign scheduler route: GET /api/v1/internal/campaigns/run. Wrong/missing bearer authentication returns 401, with no-store on all responses. Scheduling is disabled when CRON_SECRET is absent. Locks do not expire or allow automatic takeover; interrupted work needs operator reconciliation. Worker bounds remain one campaign and three sends per invocation, inside the existing 60-second Vercel function budget. No cron was added or activated: the account plan/capacity needs confirmation, and the existing runbook supplies the exact opt-in minute schedule. No new scheduler/provider dependency was added.

Existing WhatsApp module: modules/followups. Contacts need separate explicit WhatsApp consent and no subsequent opt-out. A manual owner action triggers a send; there is no automatic follow-up. Outside the 24-hour reply window, the configured template requires explicit confirmation; typed text is never silently substituted. History is tenant-scoped. Provider statuses are applied monotonically, raw-body webhooks use Meta HMAC signatures, replies are attributed by quoted message or a single recent thread, and ambiguous replies are not stored under a guessed tenant. STOP applies across all businesses that messaged that phone. Tests cover cross-tenant denial, Super Admin denial, templates, consent, STOP, duplicate webhooks and the partial-failure recovery.

WhatsApp limitations retained: API acceptance and the database history write are separate operations. A provider acceptance followed by a database failure is an uncertain send; there is no durable outbound idempotency/outbox, automatic retry queue or bulk delivery engine. Do not blindly repeat an uncertain manual send. Real template approval, Meta permissions, credentials and delivery were not exercised.

Privacy-first support grants, session-bound reauthentication, append-only access logs, owner-approved platform marketing, tenant permission checks and the UI were preserved.

Dependency advisory: [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828). The body-parser maintainer identifies 2.4.0 as the patched 2.x release. No direct dependency was added.

## Read-only production evidence

- API project go-digital-vantage-api and web project go-digital-vantage-prd are connected to the expected roots. Both project defaults report Node 24.x. Their source package engines specify 22.x; align defaults and confirm the resulting function runtime after approved deployment.
- Inspected API production deployment dpl_Fmv6gFsjNXbchyQDoDhdvnpe7PkF: READY, commit 8bc2de2. This was an upstream deployment observed during the audit, not deployed by this work.
- Both direct API and frontend-proxied GET /api/v1/health returned HTTP 200 with db=up.
- Required API env variable names are configured. NODE_ENV, PORT, MONGODB_URI, CORS_ORIGIN, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and RESEND_WEBHOOK_SECRET are marked sensitive and cannot be validated through env export. Do not infer their values from local files.
- CRON_SECRET and MARKETING_UNSUBSCRIBE_SECRET are absent from API production variable metadata; project cron definitions are empty. No scheduler call was made against production.
- Some sensitive variables, including MONGODB_URI and JWT secrets, target both Production and Preview. Treat preview isolation as unverified; separate database/users/signing secrets before preview writes or test traffic.
- Resend checked using the local production key, GET requests only: mail.godigitalvantage.com exists, sending capability enabled, verification incomplete. A matching webhook is enabled with delivered/failed/bounced/complained/suppressed events and the expected path. This does not verify the deployed webhook signing secret or delivery.

## Required external actions before release

1. Replace the exposed Resend webhook signing credential in the provider and API deployment together. Confirm whether the live sensitive value is the exposed value. The hardened application rejects the known exposed value even when outbound email is disabled. Removing it from a template does not revoke it or remove historical copies.
2. Rotate the Resend API key previously shared with development, and use a distinct restricted key/account for development. Keep live sending disabled until domain verification, signed receipt verification and an explicitly authorized inbox test are complete.
3. Replace the development placeholder JWT secrets. Separate development instant-reward and WhatsApp secrets from production. Review production Meta secret/token rotation with the operator. Do not casually change production instant-reward or marketing signing keys: existing links depend on them. JWT rotation invalidates sessions; reward-link rotation requires retention/migration planning.
4. Inject a permanent independent MARKETING_UNSUBSCRIBE_SECRET before enabled production email, and a random CRON_SECRET of at least 32 characters before scheduler access. If links were issued previously, identify their actual signing configuration before creating/replacing any unsubscribe key. The same minimum length applies to the independent signing secrets; all signing purposes must use different values.
5. Confirm a minute-capable Vercel plan or approved external scheduler and capacity. Apply the existing cron snippet only in the approved release; configure alerts for stalled heartbeats, reconciliation and unknown locks. Run approved index and append-only-audit permission checks against the actual deployed database, never an inferred name from a local env file.
6. Set both Vercel project Node defaults to 22.x, confirm effective function runtime/build settings, and isolate Preview DB and credentials. Source engines and CI are already set to 22.
7. Obtain approval for commit/push/deployment and repeat post-deploy health, auth/CSRF, tenant/privacy, cron authentication and receipt checks. No real message test is implicitly authorized by this report.

Vercel documents [sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [environment injection](https://vercel.com/docs/environment-variables), [cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). Hobby daily scheduling does not satisfy this worker's minute-level use case.

## Local operation and validation

Use Node 22. Run npm --prefix apps/api run security:audit-env for names-only configuration/reuse results; it returns nonzero for unsafe files. Current ignored development env deliberately fails until its placeholder JWT secrets are replaced; current local production env fails because it still contains the exposed webhook secret and lacks the dedicated marketing secret. Production credentials/data were not changed.

Development email remains EMAIL_ENABLED=false. To conduct a separately authorized restricted test, configure RESEND_DEV_API_KEY, RESEND_DEV_WEBHOOK_SECRET, EMAIL_TEST_MODE=true and one RESEND_TEST_EMAIL. Production RESEND_API_KEY/RESEND_WEBHOOK_SECRET are ignored in development and Preview. Automated tests inject mock transports and never send to provider accounts. WhatsApp development uses the existing loopback mock script only.

MongoDB's installed Windows service was already stopped. Tests use a newly created temporary data directory, bound to 127.0.0.1:27028, with GDV_TEST_MONGODB_URI=mongodb://127.0.0.1:27028/gdv_test. They never use local application or cloud databases. Test configuration rejects remote hosts, credentials, queries and other database names. A Node 22 CI workflow supplies its own isolated MongoDB service.

Final test/check results are recorded in the progress handoff and completion report. No live credentials, DNS, database records, scheduler settings or project settings were changed.

### Final validation (Node 22.23.4)

- Complete API suite: 340/340 passed in 26 files against the temporary loopback MongoDB instance; zero skipped. Includes privacy/support access, tenant boundaries, campaign owner approvals, consent/unsubscribe, scheduler authentication, locks/retries, serverless behavior, email safety and WhatsApp routing/STOP.
- ChromeHeadless frontend suite: 206/206 passed; zero skipped.
- ESLint, API typecheck, Angular app/spec typechecks and both production builds passed.
- Fresh API npm ci from the amended lockfile passed; all optional platform lock entries were retained. Production dependency audits report zero vulnerabilities for API and web after body-parser 2.4.0.
- Negative checks confirmed remote hosts, non-test database names and credential-bearing test URI overrides are rejected before tests execute.
- Changed-file formatting and git diff whitespace checks passed. Existing non-fatal test server-listener warnings and browser fixture/font/tracking warnings remain; these did not skip or fail tests. CI was authored but not run remotely.
- An earlier interrupted run and runs on the older checkout are superseded by this complete supported-runtime run. Live delivery/inbox tests, live cron execution and production database migrations/permission checks were not run.

Release status: application checks pass; production release remains blocked on the external secret, domain, scheduler and runtime/isolation requirements above. All hardening changes remain uncommitted.

Cleanup: the isolated MongoDB process was stopped; the original Windows MongoDB service was left unchanged. Automatic approval review blocked deletion of the temporary database directory (reason: blocked by policy), so the files remain under the temporary gdv-audit-mongo-b8tifz directory. No database service is running there. Final campaign-only regression after retaining only the upstream clock hooks: 44/44 passed.
