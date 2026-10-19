# Database (MongoDB/Mongoose)
All tenant docs carry `businessId`; indexes lead with it. Status: `users`, `refresh_tokens` (M-AUTH), `businesses`, `business_memberships` (M-BIZ), `questionnaires`, `questionnaire_versions` (M-FORM), `responses`, `contacts`, `consent_events` (M3), `qr_events` (M3) implemented; rest planned. Planned per SRS §9:

| Collection | Key fields | Indexes | Module |
|---|---|---|---|
| users ✅ | fullName, emailLowercase, passwordHash (scrypt), status active/disabled, timestamps | unique emailLowercase | M-AUTH |
| refresh_tokens ✅ | userId, familyId, tokenHash (HMAC), expiresAt, revokedAt, rotatedAt, familyRevoked | unique tokenHash; userId; familyId; TTL expiresAt | M-AUTH |
| businesses ✅ | ownerUserId, createRequestId, name, category, email?, phone?, address?, logoRef?, timezone, googleReviewUrl?, slug, status onboarding/active/disabled, onboarding{currentStep,completedSteps,completedAt} | unique slug; unique (ownerUserId,createRequestId) | M-BIZ |
| business_memberships ✅ | businessId, userId, role owner/member | unique (businessId,userId); userId | M-BIZ |
| questionnaires ✅ | businessId, draft{title,description,questions[]}, draftRevision, publishedRevision, publishedVersion, versionCounter | unique businessId | M-FORM |
| questionnaire_versions ✅ | businessId, questionnaireId, version, title, description, questions[] (insert-only; question/choice ids stable), publishedAt, publishedByUserId | unique (questionnaireId,version); businessId | M-FORM |
| responses ✅ | businessId, questionnaireId, questionnaireVersion, contactId (null = anonymous), answers[{questionId,type,label,required,text,rating,choices[{id,label}]}] (snapshot), rating (first rating answer, 1-5), consentSnapshot{reviewRequestSms,marketingSms,wordingVersion}, idempotencyKey, submittedAt (insert-only; no update/delete code) | unique (businessId,idempotencyKey); (businessId,submittedAt desc); (businessId,contactId,submittedAt) | M-RESP |
| contacts ✅ | businessId, fullName?, emailLowercase?, phoneE164?, firstResponseAt, lastResponseAt, consent{reviewRequestSms,marketingSms: last grant Date or null} | partial unique (businessId,phoneE164), (businessId,emailLowercase); (businessId,lastResponseAt) | M-CRM |
| consent_events ✅ | businessId, contactId, purpose review_request_sms/marketing_sms, choice granted, wordingVersion + wordingText snapshot, source public_form, submissionKey, capturedAt (insert-only; only explicit grants are recorded) | unique (businessId,submissionKey,purpose); (businessId,contactId,capturedAt) | M-CONSENT |
| qr_events ✅ | businessId, qrId (= slug), eventType scan, visitorHash (daily-salted HMAC of ip+UA; no raw values), windowIndex (30 min), occurredAt | unique (businessId,eventType,visitorHash,windowIndex); TTL occurredAt 400d | M-QR |
| sms_messages | businessId, contactId?, phoneE164, type, status, idempotencyKey, providerMessageId | unique idempotencyKey | M-SMS |
| call_events / campaigns / subscriptions | SRS §9 | unique providerCallId | P1 |
| audit_logs | businessId, actorUserId, action, target | (businessId,timestamp) | M-AUDIT |

## Rewards (M-REWARD)
| Collection | Key fields | Indexes |
|---|---|---|
| reward_rules ✅ | businessId, name, enabled, maxRating (default 2), mode auto/approval, discountType percent/fixed, discountValue, currency, minSpend?, maxDiscount? (percent only), validityDays, cooldownDays, maxIssuancesTotal?, maxIssuancesPerDay?, terms | (businessId,enabled,maxRating) |
| incidents ✅ | businessId, responseId, contactId?, rating, ruleId, status open/reward_pending/reward_issued/no_reward/resolved, reason (cooldown/limit/rejected), note | unique (businessId,responseId) |
| rewards ✅ | businessId, ruleId+ruleName, incidentId, responseId, contactId?, code `GDV-XXXX-XXXX`, status pending_approval/issued/redeemed/cancelled/rejected ("expired" is derived from expiresAt), rule snapshot (discount, minSpend, maxDiscount, currency, validityDays, terms), identityHash (HMAC), issuedAt, expiresAt, deliveries[{method,at,byUserId}] (manual shares), redemption{at,byUserId,requestId,orderTotal?,discountApplied?} | unique (businessId,responseId); unique (businessId,code); (businessId,status,createdAt); (businessId,identityHash,createdAt) |
| reward_quotas ✅ | key, count: atomic caps (`tot:<rule>`, `day:<rule>:<date>`, `cd:<biz>:<identity>:<window>`) | unique key |
| reward_audit ✅ | businessId, ruleId?, rewardId?, incidentId?, actorUserId?, action, details, at (insert-only) | (businessId,at); (businessId,rewardId,at) |

## M-ADMIN
users adds platformRole (USER/SUPER_ADMIN) and sessionsRevokedAt; businesses adds adminState; business_memberships adds status; questionnaires adds adminArchived. All preserve safe legacy defaults. admin_audit stores immutable operation identity/intent and outcome (pending/completed/failed), indexed by time, business/time, actor/time. Global timestamp/_id indexes support platform lists. See [admin](admin.md).

- users.sessionVersion and refresh_tokens.sessionVersion default to 0, with version in signed access tokens. admin_mutation_locks has a unique string _id scope, token referencing admin_audit intent and acquiredAt; no TTL. Business owner/member changes preserve a remaining active owner and keep primary ownerUserId consistent.

## Instant Rewards

`instant_rewards` stores one authoritative status, immutable sent terms/recipient snapshot, historical lifecycle times, revision, hashed claim/verification tokens, purpose-separated delivery-operation nonces, creator-scoped creation UUID/fingerprint, claim UUID/receipt and durable pendingEvents outbox. Indexes: unique creator+request UUID; sparse unique active token hashes; recipient email/user + creation; status+expiry; provider ID; creation+ID. No TTL deletion. `enabled` is derived from status.

`instant_reward_events` has unique event ID, reward/actor/type/time and safe metadata, indexed by reward+time and time. No token/body/secret fields. Atomic lifecycle update appends an outbox event; idempotent upsert drains only acknowledged IDs. Deferred history writes retain the outbox for subsequent reads. User permissions enum adds `instant_rewards:manage`, default empty. Existing documents require no backfill; creation of the new collections/indexes and Mongoose defaults is additive.

## Shared email provider (2026-10-19)

email_delivery_events: unique eventId, indexed providerMessageId, type (delivered/failed/bounced/complained/suppressed), occurredAt, receivedAt. No bodies, tokens or OTPs. Additive indexes; no TTL or migration of existing reward documents.
