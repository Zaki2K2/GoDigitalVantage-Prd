# Resend email configuration and Vercel runbook

Spec: [email-provider.md](specs/email-provider.md). Sending stays disabled until the following manual steps are complete. This change does not deploy, change secrets, create provider resources, or modify DNS.

## API Vercel settings

API project: Root Directory `apps/api`, Framework `Other`, Node.js `22.x`, Install Command `npm ci`, Build Command `npm run build`, Output Directory `public`. Existing `apps/api/vercel.json` retains `/api/index` rewrites, `dist/**` inclusion and 15-second function maximum. Resend domain lookup plus submission shares one eight-second abort budget. All delivery work is awaited; no process-local queue or post-response work is assumed.

Set these variables in the **API** project's Production environment (Preview only when deliberately enabled). In Vercel enter values without shell quotes:

```dotenv
EMAIL_PROVIDER=resend
EMAIL_ENABLED=false
RESEND_API_KEY=<existing or approved Resend key>
RESEND_WEBHOOK_SECRET=<webhook signing secret from Resend>
RESEND_FROM_EMAIL=GoDigitalVantage <notifications@mail.godigitalvantage.com>
RESEND_REWARDS_FROM_EMAIL=GoDigitalVantage Rewards <rewards@mail.godigitalvantage.com>
RESEND_VERIFY_FROM_EMAIL=GoDigitalVantage Verification <verify@mail.godigitalvantage.com>
RESEND_SECURITY_FROM_EMAIL=GoDigitalVantage Security <security@mail.godigitalvantage.com>
PUBLIC_APP_BASE_URL=https://<web-domain>
CORS_ORIGIN=https://<web-domain>
RATE_LIMIT_STORE=mongo
TRUST_PROXY=1
INSTANT_REWARDS_TOKEN_SECRET=<preserve existing reward signing secret>
```

Keep existing `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`. Never rotate reward/auth secrets as part of this sender migration. Retire the previous reward sender variable; it is no longer read. In production mode the API key must allow email sending and domain listing; a send-only key cannot pass the custom-domain verification gate. Restricted test mode needs sending access only. The adapter requires the exact sending domain to be verified with sending capability enabled; lookups fail closed, without trusting a manually asserted verification boolean.

The web project remains `apps/web`, build `npm run build`, output `dist/web/browser`, Node `22.x`; no email secrets belong there. Preserve the existing `/api/*` rewrite to the API project's domain and SPA fallback. Vercel environment changes take effect only in a new deployment; deployment and production secret updates require approval and were not performed.

## Domain and webhook setup

1. In Resend, open `mail.godigitalvantage.com`; copy its account-specific DNS records into the authoritative DNS provider. Use the exact DKIM and return-path SPF/MX records displayed by Resend; do not guess values, overwrite root-domain mail routing, or configure a second conflicting SPF record. Wait for Resend status **verified** and sending capability **enabled**.
2. Configure `https://<api-domain>/api/v1/webhooks/resend` for `email.delivered`, `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`. The old `/api/v1/webhooks/instant-rewards/email` URL remains compatible; use one configured endpoint to avoid redundant callbacks. Resend must reach this route without Vercel Deployment Protection blocking it; arrange the deployment's approved webhook access policy, retaining application signature verification.
3. Copy its signing secret into the API environment only with permission. Raw request bodies and Svix headers must survive proxies unchanged. Wrong/missing/stale signatures are rejected; incoming receipts continue to work while outbound email is disabled.
4. Keep `EMAIL_ENABLED=false` until DNS, API permissions, sender variables, signing secret and HTTPS frontend origin are configured. With approval, enable sending and deploy; send a controlled test to your own recipient. Inspect accepted message ID, signed delivery receipt, reward verification and claim. Acceptance alone is never reported as delivery.
5. `support@godigitalvantage.com` is intentionally not configured as a reply-to or sender. Add it only after a receiving mailbox and routing have been independently confirmed. Sender aliases on the sending subdomain do not imply receiving mailboxes.

Read-only account check during this task (2026-10-19): `mail.godigitalvantage.com` was listed with status `not_started` and sending capability `enabled`; it is **not verified**. No actual emails were submitted.

## Shared templates and retry contract

`modules/email/email.templates.ts` renders escaped HTML/text for reward, verification, OTP, password-reset, claim-confirmation and notification. `sendResendEmail` selects the appropriate configured sender. There is no arbitrary-send HTTP endpoint. OTP generation, account-email verification and password-reset endpoints remain outside this task; templates do not weaken or replace existing authentication. Claim confirmation is available as a template and is not a prerequisite of a committed claim.

Callers supply `to`, a stable `idempotencyKey`, persisted `operationStartedAt`, and rendered template output. Persist only operation identity/non-sensitive state, not rendered bodies containing tokens/OTPs. Retry the exact same key/body/sender within 20 hours. On `EMAIL_SEND_UNCERTAIN` retry that operation; never silently mint a new identity. `EMAIL_IDEMPOTENCY_CONFLICT` requires reconciliation. Older operations need an explicit new action and token rotation, as existing reward resend does. Do not auto-resend claimed rewards. Configuration failures use `EMAIL_DISABLED`, `EMAIL_NOT_CONFIGURED`, `EMAIL_SENDER_INVALID`, `EMAIL_DOMAIN_UNVERIFIED`, or `EMAIL_DOMAIN_CHECK_FAILED`. Provider response bodies and secrets are never echoed.

Shared `email_delivery_events`: unique event ID, indexed provider message ID, event type, occurredAt and receivedAt only. Signed duplicate receipts are idempotent. Events preserve separate delivered/failed/bounced/complained types; no raw webhook payload, email body, token, code or cookie is stored. Existing reward audit outbox and atomic claims remain intact. Early provider receipts are replayed after reward acceptance is saved; late old-message receipts cannot regress a newer reward state. If production disables auto-indexing, add the declared eventId unique/providerMessageId indexes through the normal migration process before enabling webhook traffic; no existing collection/index is dropped.

## Provider references

[Domain listing and statuses](https://resend.com/docs/api-reference/domains/list-domains), [signed webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Validation (2026-10-19)

- Full backend: `npm --prefix apps/api test -- --testTimeout=20000` -> 17 files, 208 tests passed. Existing concurrent Supertest listener warnings remain non-fatal.
- Final email/reward regression: `npm --prefix apps/api test -- email-provider.test.ts instant-reward-email.test.ts instant-rewards.test.ts --testTimeout=20000` -> 37 passed, including receipt recovery on read/idempotent retry.
- Frontend regression: `npm --prefix apps/web test -- --watch=false --browsers=ChromeHeadless` -> 143 passed.
- API typecheck and API/Angular production builds passed. ESLint and Prettier checks passed.
- Tests use mocked provider responses and gdv_test; no real mail was sent. External domain verification, production webhook configuration and inbox delivery remain unverified.

## Files changed for this migration

- `apps/api/src/modules/email/email.service.ts`
- `apps/api/src/modules/email/email.templates.ts`
- `apps/api/src/modules/email/email.model.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.email.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.routes.ts`
- `apps/api/src/modules/instant-rewards/instant-reward.service.ts`
- `apps/api/src/config/env.schema.ts`
- `apps/api/.env.example`
- `apps/api/.env.production.example`
- `apps/api/tests/email-provider.test.ts`
- `apps/api/tests/instant-reward-email.test.ts`
- `apps/api/tests/instant-rewards.test.ts`
- `docs/specs/email-provider.md`
- `docs/specs/instant-rewards.md`
- `docs/email-resend.md`
- `docs/instant-rewards-operations.md`
- `docs/deployment-vercel.md`
- `.claude/brain/architecture.md`
- `.claude/brain/database.md`
- `.claude/brain/api-map.md`
- `.claude/brain/flows.md`
- `.claude/brain/decisions.md`
- `.claude/brain/change-impact.md`
- `.claude/brain/progress.md`
- `.claude/brain/modules.md`

Local ignored `apps/api/.env`: non-secret sender variables and disabled flag only; secret values preserved. No Vercel or provider configuration was changed.

## Restricted testing without a custom domain

On the **separate API Vercel project only**, the following is an opt-in configuration; no Vercel settings or deployments were changed:

```dotenv
EMAIL_PROVIDER=resend
EMAIL_ENABLED=true
EMAIL_TEST_MODE=true
RESEND_TEST_EMAIL=<exact email used for your Resend account>
RESEND_TEST_FROM_EMAIL=GoDigitalVantage <onboarding@resend.dev>
RESEND_API_KEY=<existing approved key>
RESEND_WEBHOOK_SECRET=<existing approved webhook signing secret>
PUBLIC_APP_BASE_URL=https://go-digital-vantage-prd.vercel.app
```

Preserve existing `INSTANT_REWARDS_TOKEN_SECRET`, auth secrets, MongoDB, CORS and API rewrite configuration. The signing secret remains required; configure the existing `/api/v1/webhooks/resend` route for authenticated delivery evidence. No email secrets belong in the frontend Vercel project. Enter values without shell quotes in Vercel.

Defaults remain `EMAIL_ENABLED=false`, `EMAIL_TEST_MODE=false`; examples do not enable sending. Enable the flags above only for a controlled test. Test mode accepts exactly the normalized configured recipient; it does not redirect other users' reward links into the test inbox. Aliases, additional recipients and other addresses are rejected before any provider call. The test address must actually match the Resend account email; configuring another address does not override Resend's restrictions. No custom-domain lookup is performed in this restricted mode. Every template uses only the approved `onboarding@resend.dev` mailbox (display name configurable).

Issue the test reward to that same account email and sign in as that recipient. A blocked send records a failure and never grants proof, delivery or a claim. Acceptance is not delivery; retain signed receipts and normal ownership, verification, expiration and claim checks. Do not reuse pending operation keys after switching sender/mode; use an explicit resend to rotate links and obtain a new operation identity.

After custom-domain DNS verification, set `EMAIL_TEST_MODE=false` and retain the existing configured `mail.godigitalvantage.com` purpose-specific senders. The production policy rejects `onboarding@resend.dev`; live domain verification and sending capability checks resume. `EMAIL_ENABLED=false` always overrides both modes.

Provider restriction: [Vercel's Resend integration guide](https://vercel.com/academy/visual-workflow-builder-on-vercel/resend-plugin).

Restricted test-mode validation: full API suite 214/214 passed (17 files, `--testTimeout=20000`); targeted email/reward suite 43/43. API typecheck, both production builds, lint and formatting passed. No real email submission, deployment, Vercel setting or secret change was performed.

## Troubleshooting `EMAIL_NOT_CONFIGURED`

The admin message "Instant Rewards email configuration is incomplete" / "Email not confirmed: EMAIL_NOT_CONFIGURED" means the reward was saved but a required API setting is missing. Checked in this order:

1. `INSTANT_REWARDS_TOKEN_SECRET` (>= 32 chars). Optional in the env schema, so the API starts without it, but claim/verify links cannot be derived (`deriveToken`). Set once; never rotate casually (existing links stop working).
2. `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` (`sendResendEmail`).
3. `PUBLIC_APP_BASE_URL` must be HTTPS in production.

Other codes: `EMAIL_DISABLED` (`EMAIL_ENABLED` not `true`), `EMAIL_TEST_NOT_CONFIGURED` (`RESEND_TEST_EMAIL` missing), `EMAIL_TEST_RECIPIENT_BLOCKED` (recipient is not the test email), `EMAIL_SENDER_INVALID` (in test mode the sender must be exactly `onboarding@resend.dev`). After fixing the setting and redeploying, use "Retry delivery" on the reward. Do not recreate the reward.
