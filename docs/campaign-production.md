# Campaign production setup and recovery

No deployment, production migration, secret change or real email send is authorized by this document. Perform these steps only after explicit approval. The implementation remains inside the existing UI, authorization, reward and email services.

## 1. MongoDB and migration

- Confirm the actual deployed database name; do not infer it from a local env filename. Set `MONGODB_URI` explicitly through the operator's approved secret mechanism, with TLS, the intended database and approved Atlas network access. Set `NODE_ENV=production`. Preserve existing authentication/reward secrets.
- Pause the scheduler and application writers. Take an approved backup/snapshot. Use one migration operator with read/createIndex/dropIndex permissions. Runtime users need normal application read/write access.
- From the repository run `npm --prefix apps/api run campaigns:indexes -- EXACT_DATABASE_NAME --confirm-index-migration`. The CLI checks the connected database name before writes and explicitly disables auto-indexing. The migration builds a temporary response uniqueness guard, replaces only the legacy reward response index, creates declared campaign/contact/consent/suppression/order/receipt indexes, then removes the guard. It does not modify contacts, infer consent, delete duplicates or drop collections. Re-running is supported, including after interruption. Duplicate data or incompatible indexes stop the migration; investigate and repair deliberately rather than deleting records automatically.
- The CLI verifies all required unique/partial indexes. Production workers also refuse to execute with `CAMPAIGN_INDEXES_MISSING`. Super Admin monitoring shows readiness. Production connections disable automatic index creation; apply declared index migrations before turning on new writes.
- New collections: `marketing_email_consent` (unique business/contact, exact email + decision/evidence/actor/time), `marketing_email_suppressions` (unique business/email), `reward_order_claims` (unique business/order and business/reward), `campaign_scheduler_state` (singleton heartbeat). Existing campaign/recipient indexes add scheduling/retry/receipt lookup support. Existing response uniqueness remains enforced.
- Rollback: disable scheduler and outbound marketing first. Do not restore the old non-partial response index or old campaign worker once response-less campaign rewards exist. Keep the compatible schema/indexes and reconcile before any downgrade.

## 2. API Vercel project

Root `apps/api`, Framework Other, Node `22.x`, install `npm ci`, build `npm run build`, output `public`. Keep `/api/index` rewrites and `dist/**` inclusion. Source function `maxDuration` is 60 seconds. The worker stops admitting work after approximately 30 seconds, preserving time for an in-flight provider request and database saves; it sends at most three messages per invocation and never continues after the response.

Production variables (API only, no shell quotes in Vercel):

```dotenv
NODE_ENV=production
MONGODB_URI=<approved explicit database URI>
PUBLIC_APP_BASE_URL=https://<web-domain>
CORS_ORIGIN=https://<web-domain>
RATE_LIMIT_STORE=mongo
TRUST_PROXY=1
CRON_SECRET=<new cryptographically random value, at least 32 characters>
MARKETING_UNSUBSCRIBE_SECRET=<independent permanent random value, at least 32 characters>
EMAIL_PROVIDER=resend
EMAIL_ENABLED=false
EMAIL_TEST_MODE=false
RESEND_API_KEY=<approved key allowing sending and domain listing>
RESEND_WEBHOOK_SECRET=<signing secret for the configured webhook>
RESEND_FROM_EMAIL=GoDigitalVantage <notifications@mail.godigitalvantage.com>
```

Preserve the existing `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INSTANT_REWARDS_TOKEN_SECRET` and reward/verification/security sender variables documented in [email-resend.md](email-resend.md). Do not rotate `MARKETING_UNSUBSCRIBE_SECRET` without a key-retention migration: old unsubscribe links must keep working. Tokens are signed, contain tenant/contact/address data and must be redacted from access logs, error reporting and analytics. Admin DTOs exclude unsubscribe URLs, stored message bodies and email snapshots. The confirmation page clears its URL fragment immediately.

## 3. Scheduler (choose one, after approval)

For a Vercel plan supporting minute-level scheduling, add this property to **apps/api/vercel.json**, preserving the current settings, then deploy the approved revision:

```json
{
  "crons": [{ "path": "/api/v1/internal/campaigns/run", "schedule": "* * * * *" }]
}
```

Vercel invokes production cron GET requests with `Authorization: Bearer <CRON_SECRET>`. Hobby scheduling is daily and cannot support these delivery windows; use an eligible plan or an approved external minute scheduler. For an external scheduler call `https://<api-domain>/api/v1/internal/campaigns/run` directly with the same bearer header, without cookies. Preserve application authentication; configure approved Deployment Protection access rather than making the endpoint unauthenticated. No cron was added to the default source configuration because the deployed plan is unverified. See [Vercel cron authentication/concurrency](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

One request checks one campaign and sends up to three emails. With N campaigns and one call/minute, the check cycle may take N minutes; one campaign can deliver at most three emails/minute. Size schedules/windows and dispatch capacity accordingly. Higher volume or precise-minute guarantees require a queue/dispatcher, not a longer unbounded request. No new past-day windows are backfilled. DST repeated hours share a local date key; missing local times run at the next poll within the allowed send window. February 29 birthdays skip non-leap years.

## 4. Resend and public routes

1. Verify **mail.godigitalvantage.com**, with sending capability enabled. Copy the account-specific DKIM and return-path SPF/MX records from Resend into authoritative DNS; do not guess record values or replace root-domain mailbox routing. The adapter checks verification before sending.
2. Configure one webhook: `https://<api-domain>/api/v1/webhooks/resend`, subscribing to `email.delivered`, `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`. Store its signing secret in the API. Keep the existing raw-body/Svix signature verification and approved protection access. Receipts work while sending is disabled.
3. Preserve the web `/api/*` proxy to this API and SPA fallback. Unsubscribe URLs use the HTTPS web origin and this proxy. GET `/api/v1/public/campaign-unsubscribe/:token` redirects to `/email-preferences#token=...` without mutating preferences; the existing-style confirmation page submits only after a click. RFC 8058 POST to the signed URL revokes immediately, without login/cookies/CSRF. Both are no-store; repeated POST is safe. Mail headers are `List-Unsubscribe: <signed HTTPS URL>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
4. Consent is explicitly recorded by the business owner, with evidence, in the existing Contacts drawer. Legacy records and SMS-only consent never qualify. Permissions bind to business/contact/exact address; email changes require new permission. Staff cannot override unsubscribe, revocation, bounce, complaint or provider suppression. No public opt-in/double-opt-in or self-service resubscribe flow is implemented; do not bulk mark legacy contacts as opted in.
5. After configuration, migration, consent and deployment are approved, enable `EMAIL_ENABLED=true` and deploy. Any real inbox test requires separate authorization. During development all delivery tests mock the provider. Use the existing restricted Resend test mode only when explicitly authorized; it permits only the configured account recipient.

Provider references: [custom headers](https://resend.com/docs/api-reference/emails/send-email), [24-hour provider idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [unique-index behavior](https://www.mongodb.com/docs/manual/core/index-unique/).

## 5. Monitoring and recovery

Open Super Admin → Campaigns → **Refresh monitoring**. Inspect configuration/index readiness, scheduler started/completed timestamps, original last failure code, oldest checked campaigns, pending/failed/reconciliation recipients, attempt counts, next retry times and outstanding locks. Recipient history includes actual provider receipts. Monitoring excludes tokens and email/message snapshots. Refreshing never sends or releases a lock. Configure an external alert on missing cron completion beyond the expected cadence, HTTP failures, old checks, outstanding locks and reconciliation counts; this project has no connected alert provider.

Retries reuse the exact stored message, recipient, unsubscribe URL, provider key and original operation timestamp. Failures back off 1 then 2 minutes, at most three attempts. After 19 hours or an exhausted uncertain attempt, operator reconciliation is required; the provider's 24-hour key retention is not treated as permanent. Consent, suppression, address, reward and business state are rechecked for every attempt. An unsubscribe cannot recall a request already submitted to the provider.

Locks use both campaign and `offers:<businessId>` scopes, serializing campaign issuance across a business. No TTL takeover. If a worker dies:

1. Pause scheduling and prove the old invocation ended. Inspect exact lock tokens/timestamps, audit intent, recipient/provider ID, stable `campaign:<recipientId>` key, immutable payload, reward and reserved capacity in the intended database.
2. Reconcile acceptance with Resend/receipts. If accepted, persist the existing provider ID/accepted state; never send again. If uncertain outside the retry window, retain reconciliation and do not automatically regenerate a key. Release unused capacity only after proving no recipient/reward exists; lost reservations otherwise safely reduce capacity.
3. Only after reconciliation, remove locks using an exact `_id` **and token** condition. Unknown locks and order claims must never be cleared by age alone. Record the operator action. Restart scheduling and inspect the heartbeat/history. There is deliberately no UI force-resend/unlock button.

## 6. Offer and analytics semantics

Default `offerPolicy=exclusive`: an unexpired issued or pending customer offer blocks new campaign issuance. `parallel` requires every overlapping campaign to opt in; it permits holding multiple codes, not stacking them on one order. Business-scoped issuance locks prevent competing campaign workers from racing. Cancel invalidates outstanding campaign rewards; redemption independently checks campaign cancellation/business suspension. Campaign redemption requires the actual order reference; unique order and reward claims prevent two codes being redeemed against that reference. Legacy non-campaign redemption remains compatible; external POS discounts or falsified/different order references cannot be policed without a real order/POS integration.

Targeted includes skipped/suppressed/conflicted recipient records. Sent means provider acceptance, delivered means a real webhook receipt. Delivery failures deduplicate recipients across failure event types; one historically delivered recipient may later complain. Issued counts actual stored reward allocations including subsequently cancelled offers. **Redemption rate = redeemed / issued; conversion rate = redeemed / targeted**; zero denominators are unavailable. Opens/clicks/revenue are not invented. Audience estimates include explicitly consented, unsuppressed contacts and real segmentation; changes between review and sending still pass through the authoritative gate.
