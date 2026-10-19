# Instant Rewards specification (M-INSTANT-REWARDS)

Status: implementation contract, reviewed for consistency before coding.

## Existing architecture and boundaries

Angular standalone UI, Express/TypeScript services, MongoDB/Mongoose, Zod, `{data,pagination}` and `{error:{code,message}}`. Reuse cookie authentication, session-version checks, CSRF, shared Mongo-backed rate limiter, admin shell, controls, DialogFocus and notifications. Existing feedback-triggered business rewards and their redemption remain unchanged; Instant Rewards are account/email-specific entitlements in separate collections. There is no email service, verified-account-email mechanism, wallet or payment processor in this repository.

## Functional requirements

1. An active SUPER_ADMIN or explicitly delegated `instant_rewards:manage` account can create and manage rewards. Delegation is granted/revoked only by SUPER_ADMIN, with confirmation, audit and session revocation. Delegation grants only Instant Rewards APIs, not other admin APIs.
2. Choose an active registered user or a normalized email not yet registered. A selected user fixes both recipientUserId and the email snapshot. Duplicate recipient emails are normalized, not duplicate rewards; multiple deliberately distinct rewards are allowed.
3. Required title/type; optional description, validated numeric value/currency, promoCode, business association, sanitized metadata; required future expiry (up to 365 days), verificationRequired defaults true. Types: PERCENT_DISCOUNT (0<value<=100), FIXED_DISCOUNT (value>0 plus 3-letter currency), GIFT, CUSTOM.
4. Drafts may be edited only before a send operation is reserved. Recipient and terms become immutable after first send reservation. A createRequestId UUID scoped to the issuer provides creation idempotency; same key/different normalized payload is a conflict. Sending/resending never creates a second reward.
5. Administrators can send, resend with link rotation, retry an uncertain send, inspect delivery/verification/claim timestamps, temporarily disable/re-enable, and permanently revoke. All sensitive actions require confirmation. Claimed rewards cannot be disabled, revoked or made unclaimed.
6. My Rewards is accessible to signed-in accounts without business onboarding. Show Available, Claimed and Expired, with disabled/revoked/failed states explicitly visible. A user may request an emailed access link to their own available reward; links and codes are not recoverable from database hashes.
7. Claim grants a recorded entitlement and reveals its promoCode. It does not credit a wallet, take payment or assert real-world fulfillment; no such integration exists. A single atomic reward transition is the entitlement ledger.

## State machine and authoritative enablement

States: DRAFT, SENT, DELIVERED, VERIFIED, CLAIMED, EXPIRED, DISABLED, REVOKED, FAILED.

- DRAFT -> SENT: provider accepts initial email. DRAFT/FAILED -> SENT on a new successful send.
- SENT -> DELIVERED: authentic provider delivery receipt; acceptance alone is not delivery.
- SENT/DELIVERED -> VERIFIED: matching authenticated account consumes the separate emailed verification token.
- SENT/DELIVERED -> CLAIMED: verificationRequired=false and matching authenticated account presents a valid claim token.
- VERIFIED -> CLAIMED: the same verified account/email, using valid token or rewardId proof established by verification.
- Any unclaimed non-revoked/non-expired state -> DISABLED; save resumeStatus. Enable restores that state only before expiry. Never reset historical timestamps.
- Any unclaimed non-revoked state -> REVOKED permanently. Expired unclaimed records may be revoked for administrative cancellation; CLAIMED remains immutable.
- Any unclaimed non-revoked record whose expiresAt<=now has effective EXPIRED status. CLAIMED/REVOKED take precedence. Atomic lazy synchronization persists EXPIRED and its event when observed; the claim predicate enforces time even without synchronization.
- Definitive provider rejection -> FAILED for an undelivered send. A timeout/unknown acceptance keeps the transport operation PENDING and reports EMAIL_SEND_UNCERTAIN; it never invents delivery or automatically repeats with a new identity.
- Late receipts update historical delivery timestamps but never roll back VERIFIED, CLAIMED, DISABLED, EXPIRED or REVOKED.

`enabled` is derived in DTOs from status rather than stored as a conflicting boolean. `verificationRequired` is an immutable policy after sending, not a lifecycle flag. Transport operation state PENDING/ACCEPTED/FAILED describes email work, not reward claimability. DISABLED stores one explicit resumeStatus.

## Permissions and ownership

- Central server middleware checks current active account and SUPER_ADMIN or delegated permission. Normal owners/members have no platform reward privilege without delegation.
- All recipient APIs require current active session. Token possession alone never authenticates a user.
- Current normalized account email must equal recipientEmail. If recipientUserId is set it must also equal the account ID. Bind previously unbound rewards atomically on successful verification/claim.
- The application has no trusted global emailVerified flag. For verificationRequired=true, send an independent, short-lived verification challenge to recipientEmail after account authentication. Consuming it proves email possession and records verifiedBy/verifiedEmail/verifiedAt for this reward only. Account identity alone is insufficient.
- For verificationRequired=false, the emailed claim link is still mandatory until claim. My Rewards cannot bypass email possession by claiming via an ID alone. A matching account that only registered an unverified email cannot claim without the emailed token.
- A changed email, another account re-registering an address bound to a deleted user, a disabled account or an unrelated authenticated user cannot claim.
- Business association is validated and hidden from unrelated tenant endpoints; existing business membership checks are unchanged. Delegated permission is explicitly global for Instant Rewards only.

## API contracts (prefix /api/v1)

All unsafe browser calls retain existing CSRF. Only the signed raw-body provider webhook is outside browser CSRF.

Management, require instant reward manage permission:
- GET /instant-rewards/admin/users?search&pageSize: bounded active recipient lookup, safe fields only.
- GET /instant-rewards/admin: page/pageSize<=100, search/title/email, recipientUserId, status, rewardType, enabled, created from/to; summary counts.
- POST /instant-rewards/admin: validated fields plus createRequestId; 201 new/200 replay. Optional sendImmediately is orchestrated in the service. A created reward is returned with a stable sendError if delivery could not start, so retry never creates a duplicate.
- GET/PATCH /instant-rewards/admin/:id: safe detail or draft editing with expected revision.
- POST /instant-rewards/admin/:id/send|resend: {requestId:UUID,confirm:true}. Same request retries its existing transport operation; resend/new UUID explicitly rotates claim/verification links.
- POST /instant-rewards/admin/:id/disable|enable|revoke: {confirm:true,reason?}. Enforce rules in domain service.
- GET /instant-rewards/admin/:id/audit?page&pageSize: complete paginated immutable audit history.
- POST /admin/users/:id/instant-reward-access: SUPER_ADMIN only {enabled:boolean,confirm:true}; self-protection and existing serialized user administration apply.

Recipients, require active authentication and ownership:
- GET /instant-rewards/mine?group=available|claimed|expired&page&pageSize.
- GET /instant-rewards/link?token: not used because tokens must not appear in query/path request logs. Instead POST /instant-rewards/view {token} returns safe detail without consuming token or changing lifecycle.
- POST /instant-rewards/:id/request-link {requestId,confirm:true}: send to the matching email only; rotate safely, with per-user/IP rate limits.
- POST /instant-rewards/request-verification {token,requestId}: send a separate verification challenge. No global email-verified claim is made.
- POST /instant-rewards/verify {token}: consume verification token once and return the reward; record verification proof and clear token hash atomically.
- POST /instant-rewards/claim {token? or rewardId?,requestId:UUID}: proof/ownership checks and atomic conditional claim. Same actor+same requestId replays the original claim; another requestId after claim returns REWARD_ALREADY_CLAIMED. The original consumed claim-token hash may authenticate only the exact idempotent replay, never a second award.

Webhook:
- POST /webhooks/instant-rewards/email: raw JSON, signed Svix/Standard Webhooks headers verified before processing; bounded body and timestamp tolerance. Map email.delivered and definitive bounced/failed events to the current provider message ID. Duplicate receipts are idempotent. Unknown current message IDs return retryable status, not fabricated delivery.

UI routes: /admin/instant-rewards (SUPER_ADMIN), /rewards-admin (delegated administrator), /my-rewards, /instant-reward (email landing). Preserve existing /rewards and /reward/:token feedback rewards.

## MongoDB schema and indexes

instant_rewards:
- recipientUserId nullable ObjectId, recipientEmail normalized; businessId nullable ObjectId.
- title, description, rewardType, rewardValue nullable number, currency nullable string, promoCode nullable string, metadata bounded flat scalar record.
- status enum, resumeStatus nullable, verificationRequired, revision integer.
- createRequestId, createFingerprint, createdBy, updatedBy, createdAt, updatedAt.
- expiresAt (required), sentAt, lastSentAt, deliveredAt, verifiedAt, claimedAt, disabledAt, revokedAt (all historical, nullable).
- verifiedBy, verifiedEmail, claimedBy, claimRequestId, claimReceiptId, revokedBy, revokeReason.
- claimTokenHash, consumedClaimTokenHash, claimTokenExpiresAt, verificationTokenHash, verificationTokenExpiresAt; raw tokens never persisted.
- delivery and verificationDelivery: requestId, random nonce, token expiry, providerMessageId, PENDING/ACCEPTED/FAILED, startedAt, errorCode. Nonce is not a bearer token. It permits reconstructing the exact retry payload using a dedicated server secret.
- pendingEvents: private durable audit outbox, never returned in DTOs.

Indexes: unique (createdBy,createRequestId); recipientEmail/createdAt; recipientUserId/createdAt; status/expiresAt; createdAt/_id; sparse unique active/consumed claim and active verification hashes; sparse providerMessageId; sparse event metadata.providerMessageId for historical receipt reconciliation. No TTL deletion of rewards or audit history.

instant_reward_events:
- unique event UUID, rewardId nullable for invalid attempts, action, actorId nullable, actorType ADMIN/USER/PROVIDER/SYSTEM, timestamp, bounded safe metadata.
- indexes rewardId/timestamp/_id, timestamp.
- Successful state transitions append an event to the reward in the same atomic write. Flush into events via unique upsert, then remove only flushed IDs. A crash/failure leaves durable outbox events for retry/read draining; state and lifecycle audit cannot diverge silently.
- Failed claim attempts are logged separately without raw token/request body. Unknown token errors do not expose reward identity.

users.permissions: enum array containing optional instant_rewards:manage, default empty. Registration never accepts permission assignment. Safe session DTO includes permissions for navigation; every API independently checks database permissions.

## Email and cryptography

Configured provider: Resend HTTPS API; optional credentials and sender configured through validated environment. There is no development fake-send mode in production paths. Missing configuration returns EMAIL_NOT_CONFIGURED. A test-injected adapter is used only in tests.

- Dedicated INSTANT_REWARDS_TOKEN_SECRET (>=32 chars) plus random 32-byte nonce derives a purpose-separated HMAC token for a single delivery operation. Only token hash and non-bearer nonce are stored, allowing exact provider-idempotent retries without persisting raw tokens or email bodies containing them.
- Claim link TTL 48 hours, verification TTL 15 minutes, both capped by reward expiresAt. Tokens are 256-bit opaque strings. Provider request idempotency key is reward+purpose+request UUID; retry same payload only within the provider's documented window (bounded locally to 20h). Older uncertain operations need explicit new resend/rotation, not silent duplicate submission.
- Separate claim and verification token domains/hashes. Resend rotates prior active claim and verification challenges. Already-established verification proof remains tied to the same account/email.
- URLs use fragments: PUBLIC_APP_BASE_URL/instant-reward#token=... or #verify=.... The landing component reads the fragment into memory and removes it from browser history before any API call. Never copy reward tokens into login returnUrl, localStorage, logs or analytics. Inline login reuses existing auth service/form behavior to preserve token only in memory. Refreshing a scrubbed page requires reopening the email.
- Email includes escaped title/summary/value, expiry and View / Claim Reward CTA; verification email labels the one-time confirmation clearly. No sensitive IDs in URL. Promo code is revealed only after claim, not in pre-claim email/list.
- Accepted send -> SENT. DeliveredAt only from an authenticated provider receipt. No claims of inbox placement, human reading or real-world redemption.
- Configure RESEND_API_KEY, RESEND_REWARDS_FROM_EMAIL, INSTANT_REWARDS_TOKEN_SECRET, RESEND_WEBHOOK_SECRET. Use a verified sender and HTTPS PUBLIC_APP_BASE_URL in production. Do not contact real recipients during automated tests.

Provider references (primary): https://github.com/resend/resend-openapi/blob/main/resend.yaml ; https://resend.com/docs/dashboard/emails/idempotency-keys ; https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests .

## Atomic operations and expiry

All mutations use revision/status/hash/owner/expiry predicates. Claim and its success event are one MongoDB document update; claimReceiptId/requestId/actor establish a unique entitlement. Disable/revoke/resend racing claim can only win before claim; after CLAIMED they fail. Retry CAS conflicts against current state; never restore stale snapshots.

Lazy expiry synchronizes bounded batches/current record and appends EXPIRED once. Effective DTO and all claim/verify/send predicates check server time independently, so no cron correctness dependency exists. Unclaimed DISABLED rewards also expire. All historical timestamps remain populated after subsequent transitions.

## Errors and safeguards

Stable codes: REWARD_NOT_FOUND, REWARD_NOT_OWNER, INVALID_REWARD_TOKEN, REWARD_TOKEN_EXPIRED, REWARD_EXPIRED, REWARD_DISABLED, REWARD_REVOKED, REWARD_ALREADY_CLAIMED, REWARD_VERIFICATION_REQUIRED, REWARD_INVALID_STATE, REWARD_REVISION_CONFLICT, IDEMPOTENCY_CONFLICT, EMAIL_NOT_CONFIGURED, EMAIL_SEND_FAILED, EMAIL_SEND_UNCERTAIN, SEND_RECONCILIATION_REQUIRED, INVALID_WEBHOOK_SIGNATURE, RATE_LIMITED.

Validate UUIDs, normalized email, ObjectIds, values, dates, string lengths and flat metadata keys/size. No raw token/hash/nonce/secret/cookie is exposed to admin or user DTOs/events/errors. Correct actor and business scope are never trusted from client fields. No anonymous enumeration. Rate-limit send/resend, request-link, verification and claim, using the existing shared store option. Use no-store and Referrer-Policy: no-referrer for sensitive reward endpoints/landing. Provider errors are sanitized to stable codes, never echoed raw.

## Acceptance criteria and staged test plan

1. Spec precedes code; domain rules and transition/expiry helpers tested before persistence wiring.
2. Authorized create, normalized recipient lookup/unregistered email, create replay and payload conflict; unauthorized and owner-only business roles denied.
3. Adapter receives correct recipient/escaped email/expiry/opaque fragment CTA. No raw token in DB or audit. No configured provider => visible safe failure, not SENT/DELIVERED.
4. Matching user requests challenge; wrong user cannot view/verify/claim. Valid one-time challenge binds verified account; expired/reused/rotated/invalid tokens rejected. User registering later can bind; changed/deleted/blocked account cannot bypass binding.
5. Atomic claim succeeds once. Same UUID replay returns receipt, different UUID rejects, simultaneous claims grant exactly once, and concurrent disable/revoke cannot restore or unclaim.
6. Disabled/expired/revoked cannot claim; valid disable/enable preserves timestamps/proof; claimed cannot revoke/disable. Persist expiry audit exactly once when synchronized.
7. Transport success/definitive failure/uncertain timeout, same-operation retries, explicit resend/rotation and webhook signature/timestamp/receipt replay tested without real email. Provider acceptance does not imply delivery.
8. Admin pagination/filter/search/date/type/user/enabled, summary counts, safe DTOs, full audit history/outbox recovery and delegated permission boundaries tested.
9. UI tests: create/select email/user, validation, list/filter/detail/timeline, confirmations, delivery failures, delegation, My Rewards groups, scrubbed email link, inline sign-in, verification and claim replay feedback, loading/empty/error states and accessibility.
10. Run full API/frontend suites, typecheck, lint, formatting and both production builds. Document exact results and external delivery configuration/testing limitations without claiming live delivery.

## Review checklist before implementation

- One authoritative lifecycle; enabled is derived; transport state is separate.
- No verified-email assumption exists: independent emailed proof is implemented for required verification.
- Non-verification mode still requires email-link possession; My Rewards ID cannot bypass it.
- Hash-only storage and reconstructible provider-idempotent retries are consistent through purpose-separated secret+random nonce.
- One-document claim+event and durable outbox avoid requiring replica-set transactions locally.
- Existing feedback rewards, business authorization, CSRF and session revocation are preserved.

Email provider revision: [email-provider.md](email-provider.md) governs shared templates, fail-closed enablement, domain verification and generic receipts.
