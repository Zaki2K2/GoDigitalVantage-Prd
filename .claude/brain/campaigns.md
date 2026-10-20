# Campaigns (M-CAMP)

## Audit and reuse

Audited CLAUDE.md, brain entries, Business/membership/moderation, CRM/consent, rewards/promos, forms/responses, QR, shared email/webhook, Admin/Super Admin and Angular shell/forms/dialogs/tables. Existing roles: owner/member; no tenant delegation editor. Contacts originate from feedback with per-business unique email/phone. SMS consent remains separate from the explicit promotional-email consent ledger. There is no customer inbox, push provider, visit/review event stream, loyalty ledger, free-item reward or scheduler. Resend is real, guarded and disabled by default. Receipts record delivery/failure, not opens/clicks. Rewards already support immutable percentage/fixed discounts, unique codes, signed links, minimum spend, expiry and atomic single-use redemption. Campaigns reuse these services directly.

## Architecture and data

API source: `apps/api/src/modules/campaigns/`. Domain provides configuration validation, enums, presets and timezone trigger evaluation. Audience service requires a business ID. Service owns audited draft CRUD/revision/lifecycle. Execution service owns backend selection, offer issuance and delivery retries. A provider interface currently exposes email only.

- `campaigns`: always tenant-bound, including platform ownership. Creator, status, revision, campaign type, audience, absolute date range, IANA timezone, trigger/recurrence/local send window, channels, offer terms, issuance/per-customer limits, priority, timestamps, allocated counter and optional unique template-assignment key.
- `campaign_executions`: unique campaign/window, tenant, reference time, scan cursor, running/completed state, targeted count and timestamps. Window is `once` or local calendar date.
- `campaign_recipients`: unique campaign/dedupe key, tenant/contact/execution/window, status, attempts, first-operation timestamp, reward/provider IDs, immutable message/address snapshot, error and timestamps. Recipient history excludes message and email snapshots.
- `campaign_locks`: canonical campaign ID, operation token and acquisition time. Serializes worker/state changes on standalone MongoDB; no pretend multi-document transactions.
- `campaign_templates`: Super Admin global generic configurations. Built-in templates are configuration presets. Global templates cannot contain tenant contact IDs. Assignment creates distinct tenant-scoped platform drafts; each is reviewed/activated independently. Unique assignment keys prevent repeated assignment creating duplicates.
- `contacts`: nullable MM-DD birthday/anniversary (leap day valid), tags, segment and loyalty level. Metadata updates cannot change identity or consent. Tenant/date/tag/segment indexes added. Interaction thresholds query real tenant feedback responses.
- `rewards`: nullable response/rule references for campaign issuance, campaignId and unique campaignRecipientId. Response uniqueness becomes a partial unique index for real ObjectIds. Campaign issuance delegates to the existing reward constructor and redemption path; no synthetic responses/incidents/rules.
- Existing `admin_audit`: create/update/schedule/activate/pause/resume/cancel/execute/complete, template creation and profile changes. Actor identity, role and timestamp retained. Scheduler role SYSTEM with creator attribution. Audit intent must persist before mutation. Failed attempts may have partial progress; pending indicates unknown outcome, not success.

## Permissions and isolation

`middleware/business-permissions.ts` defines campaigns:read, campaigns:manage and contacts:manage with centralized owner/member mappings. Owners manage; members inspect. Tenant routes retain requireAuth + live requireBusinessAccess including business moderation. Platform routes require live Super Admin. Ordinary tenant membership is never bypassed for Super Admin. Business owners cannot alter platform-owned campaigns. All resource selection, contact filters, response counts, issuance and analytics stay tenant-scoped.

Workers recheck active business, creator account and active owner membership or platform role. Deleted/blocked creators, demoted owners and suspended/archived/deleted businesses stop execution. Workers and state changes share a lock. Only drafts can be edited; cancel/duplicate scheduled campaigns to change configuration. Revision/current-state checks reject stale actions. Application writes retain CSRF; scheduler uses independent >=32-character constant-time bearer authentication.

## APIs

Both `/api/v1/businesses/:businessId/campaigns` and `/api/v1/admin/campaigns`:

- GET root: bounded `{data,pagination}`, status filter; admin additionally businessId; real targeted/sent/redeemed page totals.
- POST root `{input,businessId?}`: draft; tenant URL ID authoritative; admin requires explicit active target business.
- GET `/templates`: presets and up to 100 global templates.
- GET `/:campaignId`: configuration, audience estimate, backed metrics, latest 30 executions, paginated recipient history.
- PATCH `/:campaignId` `{input,revision}`: current draft only.
- POST `/:campaignId/duplicate`: configuration-only independent draft.
- POST `/:campaignId/schedule|activate|pause|resume|cancel` `{confirm:true,revision,confirmedCount?}`. Schedule/activate/resume require a fresh matching estimate, including zero, and unexpired campaign.

Super Admin: POST `/admin/campaigns/templates` with generic configuration; POST `/admin/campaigns/templates/:id/assign` with `{businessIds:[...]}` (max 50), or `{all:true,cursor?}` (10 active businesses per request, nextCursor response). UI follows all-business cursors. Repeated assignment reuses the same template/business draft. Assignment does not activate or send.

PATCH `/businesses/:businessId/contacts/:contactId/campaign-profile`: owner-only validated dates/tags/segment/loyalty; strict allowlist, tenant lookup and audit.

GET `/api/v1/internal/campaigns/run`: bearer-authenticated scheduler, one bounded worker batch. Frontend has no scheduling authority.

## Rule semantics

Supports one-time/date range, daily, selected weekdays/weekends, monthly day, yearly month/day, birthday/anniversary with 0â€“30 days advance notice, welcome and inactive. Start inclusive/end exclusive. Send window is local HH:mm in an IANA timezone within one day; overnight requires two campaigns. Missing monthly days/non-leap February 29 are skipped. DST repeated hours share one calendar window; a nonexistent send time waits for the next poll within the allowed window. Downtime does not create new past calendar windows. Already-running windows can finish on a later due poll until expiry.

Audience filters combine all/selected, all required tags, segment equality, birthday, inactivity age, newly created contacts, loyalty level and minimum actual feedback interactions. Estimates require explicit, address-bound marketing consent and exclude recorded suppressions; execution independently skips invalid, missing or newly suppressed recipients. Estimates are point-in-time, not a recipient snapshot. Execution freezes its reference date and scans by cursor. New matching contacts inserted behind the cursor wait for another window.

One recipient/offer per customer/campaign/window. Birthday/anniversary key uses occasion year, including advance notices crossing New Year; next year works even with per-customer limit one. Welcome/inactive send once per customer per campaign; a fresh inactivity episode requires a new/duplicated campaign. Other recurrence also respects total per-customer limits. Total issuance is reserved before insertion: interruptions may waste capacity but never exceed it. Exclusive offers block overlapping issuance by default; parallel offers require explicit opt-in from every overlapping campaign and remain limited to one code per order. Priority is a secondary scheduler ordering hint.

## Execution and retries

1. Select least recently checked active/scheduled campaign whose start has passed; update check timestamp for round robin, acquire its durable lock.
2. Recheck authority, status, expiry and trigger. Finish a running execution before another window.
3. Persist audit intent; load up to 3 retryable recipients; scan up to 30 tenant contacts after cursor. Cursor restrictions intersect with selected audience restrictions.
4. Reserve capacity; insert unique recipient; create/reuse existing reward; persist immutable message/address before provider call.
5. Store provider ID and accepted, never fabricate delivery. At most 3 provider calls per request; retry identical payload/key, up to 3 attempts within 19 hours. Accepted recipients never resend. Missing/deleted/invalid contacts skip. Older unknown operations enter reconciliation without a new automatic provider key.
6. Persist cursor after each scanned contact. Complete execution when scan/retries finish. One-time campaign completes; recurring remains eligible. Expired campaigns complete on the next poll.

Locks have no TTL/automatic takeover. A serverless termination may leave an external send or partial reservation unknown. Operator must inspect lock, audit, recipient, reward and provider outcome before clearing the exact reconciled lock token. Provider idempotency is time-limited. No background work continues after response. Failed intent means the attempt failed and can contain partial progress.

## UI and metrics

`/campaigns`, `/admin/campaigns`, existing AppShell navigation, semantic cards/tables/forms/buttons and DialogFocus. One five-step modal builder for blank/built-in/global configurations (template, offer, customers, schedule, review). Detail/review shows audience estimate, schedule, recurrence, offer/validity, email and execution/recipient history. All activation requires explicit confirmation; >=500 recipients visibly identifies a large campaign. Owner profile editor is inside Contacts drawer. Admin assigns selected/all active businesses as drafts.

Real metrics only: targeted, provider-accepted sent, webhook-confirmed delivered, failed/skipped/reconciliation, issued/redeemed rewards. Redemption rate = redeemed / actual issued offers; conversion rate = redeemed / targeted; zero denominators unavailable. Duplicate receipts collapse per recipient/type. Opens/clicks/claims/revenue/purchase conversion are not tracked or displayed. Detail API additionally exposes delivery-failure receipts; recipient errors are visible in UI.

## Production configuration and limitations

1. Before enabling execution, explicitly run `npm --prefix apps/api run campaigns:indexes -- EXACT_DATABASE_NAME --confirm-index-migration` with the intended MONGODB_URI. It verifies connected database name, builds partial response-uniqueness before dropping the legacy index, then builds campaign/contact/recipient indexes. No data deleted. Stop old writers during deployment, deploy compatible API before scheduler. Migration was not run on application/production data in this task.
2. Set a new >=32-character CRON_SECRET in deployed API. Configure trusted scheduler GET to internal run route with `Authorization: Bearer <secret>` at least every minute. Keep secret in scheduler/deployment config, never frontend. No production cron or secret automatically installed. API Vercel maxDuration raised 15 -> 60 seconds for bounded provider work.
3. Enable the existing provider only after sender/domain/webhook configuration in `docs/email-resend.md`; test-mode restrictions stay intact. No emails, DNS/provider settings, secrets or deployment changed in this task.
4. Monitor execution lag, failures, reconciliation and pending locks. One call handles one campaign and <=3 emails; polling frequency/capacity must fit audience sizes, campaign count and windows. This is a safe low-volume serverless worker, not a high-volume queue or exact-minute SLA. A queue/dispatcher is needed for higher volume; locks and stable recipient/provider keys are reusable seams.
5. Only existing percentage/fixed discounts and email are offered. Free items, points, shared custom codes, custom reward actions, inbox/push, SMS/WhatsApp, budget accounting, real visit/review rules, arbitrary cron expressions, template edit/version UI and bulk activation are not implemented. Existing SMS consent is never reinterpreted as email consent.

## Verification

API/domain/integration tests cover auth/CSRF, tenant/role/platform isolation, audited CRUD/lifecycle/revision conflicts, templates/assignment, dates/timezones/recurrence/expiry, profile validation/segmentation, annual/window dedupe, selected-audience cursor isolation, zero audience, moderation/owner loss, reward redemption reuse, partial delivery/idempotency/retry age, abandoned locks, audit failure and real receipt analytics. Angular covers template builder, member controls, platform API, large-audience confirmation and errors. Final commands/results: progress.md.


## Production hardening (2026-10-20)

Authoritative setup and recovery runbook: [campaign-production.md](../../docs/campaign-production.md). Existing permissions, lifecycle, generic builder and visual design are preserved.

- Explicit owner-recorded email consent with evidence/actor/time, exact tenant/contact/address binding and audited changes. Legacy/SMS-only contacts are denied. Customer unsubscribe and provider bounce/complaint/suppression cannot be overridden by staff. Rechecks apply before every initial send and retry.
- Added marketing_email_consent, marketing_email_suppressions, reward_order_claims and campaign_scheduler_state. The Contacts drawer records consent; signed unsubscribe links support scanner-safe GET confirmation and unauthenticated RFC 8058 POST. Permanent MARKETING_UNSUBSCRIBE_SECRET is required in production. Resend receives one-click headers. Public self-service opt-in/resubscribe is not implemented.
- Exclusive/parallel offer policies, business-scoped issuance serialization, actual-order references and unique order/reward claims prevent unintended campaign stacking. Cancellation invalidates unredeemed campaign offers; redemption rechecks cancelled campaigns and suspended businesses. Existing non-campaign redemption remains compatible; external POS discounts/order identity require a future POS integration.
- Bounded worker admission budget (~30 seconds), max three provider calls, 1/2-minute retry backoff, max three attempts within 19 hours, immutable provider payload/key and no automatic unknown-lock takeover. Legacy stored promotional payloads without unsubscribe links enter reconciliation instead of being sent.
- Constant-time CRON_SECRET gate, durable scheduler heartbeat, campaign check/completion/failure timestamps, paginated Admin monitoring, retry visibility and index/config readiness. No force-resend or unlock actions. Monitor both campaign and offers:<businessId> lock scopes.
- Production auto-indexing is disabled. The explicit, repeatable migration adds and verifies all required campaign/consent/order/receipt uniqueness indexes using the response uniqueness guard. Production workers refuse missing indexes. No migration runs during deployment/startup; duplicate data is an operator blocker, never automatically removed.
- Analytics now use issued offers for redemption rate and targeted recipients for conversion. Failure receipts deduplicate per recipient across failure types. Real provider acceptance and delivery remain distinct; unavailable metrics stay absent.
- Additional mocked end-to-end journeys cover Birthday, Weekend, Tuesday, Welcome and Inactivity from permission/consent through delivery, webhook and redemption, plus unsubscribe suppression, competing offers/order claims, cancellation, suspension, DST, leap birthdays, duplicate identities, monitoring/auth and migration readiness.

Production blockers: approved migration; verified Resend domain/key/webhook; permanent unsubscribe and cron secrets; a minute-capable scheduler/adequate throughput; recorded consent; approved deployment and inbox verification. Vercel Hobby daily cron is unsuitable. Exact configuration, links to primary provider documentation, capacity limits and token-safe lock reconciliation are in the runbook. No real send, production migration, deployment, secret change, commit or push was performed.

Campaign UI (2026-10-20): both listing routes now use equal-height responsive campaign cards with name, offer/type, schedule, ownership and status. Secondary metrics, rules, executions and recipient events stay in the detail modal; Admin monitoring opens in the same modal shell. No backend contracts, permissions or delivery behavior changed.

Create, draft edit, duplicate and template use share the existing Angular Forms configuration and authorized business/contact pickers. Duplicate opens an independent prefilled builder and makes no write until Save Draft. Built-in and global templates populate this builder; global assignment uses one picker modal, selected-business assignment or explicitly confirmed all-active-business assignment. Template creation remains available from review.

Modal layout uses the existing surface/ink/line/accent tokens, semantic buttons/fields/badges/cards, Icon and DialogFocus. Header/footer remain fixed while one central body scrolls. Five steps retain description/type, percentage/fixed offer, currency, purchase bounds, terms, issuance limits, priority, overlap policy, every audience filter, timezone and all trigger settings. Optional settings are disclosures, expanded automatically for validation errors. UTC campaign bounds remain explicitly labelled; local send-window semantics are unchanged. Email remains the only supported channel.

Draft state survives step changes. Dirty close/Escape, template replacement, router navigation and browser unload are guarded; discard confirmation replaces modal content without stacking focus traps. Background is inert, focus remains inside the modal and returns to its initiating action on close. Field errors are connected with aria-describedby/aria-invalid. Save & review persists the draft, then fetches fresh audience/revision for explicit activate/schedule confirmation; >=500-recipient warning remains. Failed operations retain the modal for inspection/retry. No normal campaign operation navigates away from the listing.


Shared dropdown migration (2026-10-20): campaign filters/builder selects and contact marketing-consent selection use AppSelect; card actions use ActionMenu. Both share top-layer overlays inside the existing DialogFocus modal hierarchy. Native validation, values, lifecycle handlers and all authorization/consent/reward/execution contracts are unchanged. See [dropdowns](dropdowns.md).
