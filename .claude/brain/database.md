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
