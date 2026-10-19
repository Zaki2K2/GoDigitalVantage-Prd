# Instant Rewards operations

Specification: [instant-rewards.md](specs/instant-rewards.md).

## Configure delivery

Use [shared Resend configuration](email-resend.md). EMAIL_ENABLED defaults false; provider domain verification is checked before sending. Set API environment secrets (never commit actual values):

- `RESEND_API_KEY`: Resend sending key.
- `RESEND_REWARDS_FROM_EMAIL`: `GoDigitalVantage Rewards <rewards@mail.godigitalvantage.com>`; verification uses `RESEND_VERIFY_FROM_EMAIL`.
- `INSTANT_REWARDS_TOKEN_SECRET`: dedicated cryptographically random secret of at least 32 characters, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `RESEND_WEBHOOK_SECRET`: signing secret from the Resend webhook configuration.
- `PUBLIC_APP_BASE_URL`: public HTTPS frontend origin in production. Keep existing same-origin API rewrite, cookie and CSRF setup.
- `RATE_LIMIT_STORE=mongo` on multi-instance/serverless production, as for existing limiters.

Subscribe Resend webhook `https://<api-host>/api/v1/webhooks/instant-rewards/email` to `email.delivered`, `email.bounced`, `email.failed`, `email.complained`, and `email.suppressed`. The API verifies the raw payload signature and timestamp. Use the actual API origin (or an unchanged-body proxy). Never paste webhook secrets into browser settings.

No sender means sends fail safely with `EMAIL_NOT_CONFIGURED`; the created reward remains available for explicit admin retry. Acceptance marks SENT only. Webhook success proves provider delivery, not that the person read it. No live email is sent by automated tests.

## Administrative access

Super Admin: Admin -> Instant Rewards. On a user's details, Toggle Instant Rewards access grants/removes the module-specific permission after confirmation. This revokes that user's sessions; they must sign in again. Delegated managers use `/rewards-admin`; permission does not grant other admin or business APIs.

Create a draft or send immediately. Search a user or enter an email not yet registered. Draft terms are editable until first send reservation. Confirm send/resend/disable/enable/revoke from details. Claiming records a single entitlement receipt and reveals any reward code; external fulfillment is an integration point, not automatic money movement.

Pending delivery: use **Retry pending delivery**, preserving request UUID and provider payload. After 20 hours or after changing token signing configuration, use explicit **Resend email**, which rotates old links. A definitive rejection requires a new resend. Never recreate a reward to retry email.

## Recipient flow

My Rewards is independent of business onboarding. Open the email while signed in with the recipient account. The landing page removes the token fragment from the address bar and holds it only in memory. Inline login preserves it; reloading requires reopening the email. Register if needed, then reopen the original email link. An account email change makes its old rewards inaccessible until the matching account email is restored under the application's normal account controls.

If required, request separate verification, then open the new email within 15 minutes. Claim links last at most 48 hours; both are capped by reward expiry. Request replacement links through My Rewards. Claim is idempotent only for the original actor+request UUID; further independent attempts return `REWARD_ALREADY_CLAIMED`. Claimed receipts remain visible after expiry.

## Database and recovery

New Mongoose collections/indexes are additive. Deploy indexes before enabling traffic if production disables auto-indexing; create all indexes declared in `instant-reward.model.ts` using the deployment's normal database migration process. Do not run broad `syncIndexes()` against production because that can remove unrelated indexes.

Lifecycle and success audit event are committed together in one document. History writes use unique event upserts. An event-store failure emits a sanitized deferred warning and retains `pendingEvents`; reward reads/lists drain them again. Monitor deferred warnings and `pendingEvents` counts. No automatic TTL deletion applies to reward/audit history. Back up and retain them according to the application's data policy.

Expiry is enforced server-side without a cron. Reads persist up to 100 due statuses at a time; effective DTO/summary/claim predicates remain correct beyond that batch. A regularly paged admin read can synchronize idle records if desired.

Provider notifications racing the send response may initially return retryable 503 until the provider message ID is stored. Resend retries notifications. Check delivery history if retries are exhausted. Unknown or obsolete IDs never grant claims or expose recipients.

Keep the token signing secret stable for pending retry payloads. Rotating it requires explicit new sends for pending operations; existing accepted links remain verifiable by their stored hashes until expiry/rotation.

## Verification

API: `npm --prefix apps/api test`, `npm --prefix apps/api run typecheck`.
UI: `npm --prefix apps/web test -- --watch=false --browsers=ChromeHeadless`.
Build/check: `npm run build`, `npm run lint`, `npm run format:check`.
Tests use `gdv_test` only, injected mail delivery and simulated signed receipts. A deployment smoke test with a controlled recipient must additionally verify real sender acceptance, inbox receipt, webhook delivery, email challenge, single claim and revoked/expired rejection.

## Implementation verification (2026-10-19)

- `npm --prefix apps/api test -- --testTimeout=20000`: 16 files passed; 195 tests passed. This includes 27 new Instant Rewards tests. An initial default-timeout run hit 5-second timeouts in existing tests under local load; the full longer-timeout run passed. Existing concurrent Supertest harness emits listener-count warnings.
- `npm --prefix apps/api test -- instant-rewards.test.ts --testTimeout=20000`: 21 integration tests passed after the final historical receipt regression assertion.
- `npm --prefix apps/web test -- --watch=false --browsers=ChromeHeadless`: 143 passed, including 9 new screen tests. Chrome shutdown warnings occurred after all tests passed.
- API `typecheck`, both production builds, repository ESLint and Prettier checks passed.
- Historical pre-migration check: the former sending domain was unverified. Current domain/enablement status is documented in [email-resend.md](email-resend.md). No real reward email, recipient inbox delivery or production webhook was asserted as verified. A verified sender and webhook signing secret are still required.

## Created/changed files

- `.claude/brain/admin.md`
- `.claude/brain/api-map.md`
- `.claude/brain/architecture.md`
- `.claude/brain/change-impact.md`
- `.claude/brain/database.md`
- `.claude/brain/decisions.md`
- `.claude/brain/flows.md`
- `.claude/brain/frontend-map.md`
- `.claude/brain/modules.md`
- `apps/api/.env.example`
- `apps/api/.env.production.example`
- `apps/api/src/app.ts`
- `apps/api/src/config/env.schema.ts`
- `apps/api/src/middleware/error-handler.ts`
- `apps/api/src/middleware/rate-limit.ts`
- `apps/api/src/modules/admin/admin.actions.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/modules/admin/admin.service.ts`
- `apps/api/src/modules/auth/user.model.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.auth.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.domain.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.email.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.model.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.routes.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.schemas.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.service.ts`
- `apps/api/tests/instant-reward-domain.test.ts`
- `apps/api/tests/instant-reward-email.test.ts`
- `apps/api/tests/instant-rewards.test.ts`
- `apps/web/src/app/app.routes.ts`
- `apps/web/src/app/core/auth/auth.guard.ts`
- `apps/web/src/app/core/auth/auth.service.ts`
- `apps/web/src/app/features/admin/admin.page.html`
- `apps/web/src/app/features/admin/admin.page.ts`
- `apps/web/src/app/features/auth/login.page.ts`
- `apps/web/src/app/features/instant-rewards/instant-reward-details.ts`
- `apps/web/src/app/features/instant-rewards/instant-reward-landing.page.ts`
- `apps/web/src/app/features/instant-rewards/instant-rewards-admin.page.html`
- `apps/web/src/app/features/instant-rewards/instant-rewards-admin.page.ts`
- `apps/web/src/app/features/instant-rewards/instant-rewards.api.ts`
- `apps/web/src/app/features/instant-rewards/instant-rewards.spec.ts`
- `apps/web/src/app/features/instant-rewards/my-rewards.page.ts`
- `apps/web/src/app/features/shell/app-shell.ts`
- `apps/web/src/index.html`
- `docs/instant-rewards-operations.md`
- `docs/specs/instant-rewards.md`
