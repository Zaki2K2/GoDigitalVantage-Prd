# API map (prefix `/api/v1`)
Implemented:
| Route | Module | Files | Web consumer |
|---|---|---|---|
| GET /health | M-CORE | `modules/health/health.routes.ts` | ops |
| GET /auth/csrf | M-AUTH | `modules/auth/auth.routes.ts` | `AuthService` (sets `gdv_csrf` cookie) |
| POST /auth/register, /auth/login | M-AUTH | same; Zod `auth.schemas.ts`; rate-limited | login/register pages |
| POST /auth/refresh, /auth/logout | M-AUTH | same; `auth.service.ts` (rotation, reuse detection) | interceptor / home |
| GET /me | M-AUTH | same; `middleware/require-auth.ts` | session restore |

| POST /businesses (idempotent via `createRequestId`), GET /businesses | M-BIZ | `modules/businesses/business.routes.ts`, `.service.ts`, `.schemas.ts` | `BusinessApi` |
| GET, PATCH /businesses/:businessId (PATCH owner-only) | M-BIZ | same; guarded by `requireBusinessAccess(findMembership)` | profile page, wizard |
| GET, PATCH /businesses/:businessId/onboarding (PATCH owner-only) | M-BIZ | same | `OnboardingStore` |

| GET /businesses/:id/questionnaire; PUT .../questionnaire/draft (owner, `baseRevision`); POST .../questionnaire/publish (owner, `expectedRevision`); GET .../questionnaire/versions/:v | M-FORM | `modules/questionnaires/*` | `QuestionnaireApi`, builder |
| GET /businesses/:id/qr, qr.svg, qr.png (`?download=1`) | M-QR | `modules/qr/qr.routes.ts` | `QrPanel` |
| GET /public/:slug (anonymous, no cookies/CSRF) | M-PUB | `modules/public/public.routes.ts` -> `getPublicForm` | `/r/:slug` page |
| POST /businesses/:id/onboarding/finish (owner) | M-BIZ | `business.service.finishOnboarding` | wizard QR step |

| POST /public/:slug/scan (anonymous, 204) | M-QR | `modules/qr/scan.service.ts` | `/r/:slug` page, once per load |
| POST /public/:slug/responses (anonymous; 201 new / 200 duplicate; 422 `SUBMISSION_INVALID` `details.issues[{questionId,field,message}]`; 429 limiter) | M-RESP | `modules/public/public.routes.ts` -> `responses/submission.service.ts` | `PublicFormPage` |
| GET /businesses/:id/responses (`page,pageSize,search,rating,contact=identified|anonymous,version,from,to`) -> `{data,pagination}`; GET .../responses/:responseId | M-RESP | `modules/responses/response.routes.ts`, `response.service.ts` | `ResponsesPage` |
| GET /businesses/:id/contacts (`page,pageSize,search`) -> `{data,pagination}`; GET .../contacts/:contactId (+ responses, consentEvents) | M-CRM | `modules/responses/response.routes.ts` (CRM router), `contacts/contact.service.ts` | `ContactsPage` |
| GET /businesses/:id/dashboard?days=7..90 | M-DASH | `modules/analytics/dashboard.service.ts` | `DashboardPage` |

M3 rules: GET /public/:slug now also returns `business.{category,googleReviewUrl(https only)}` and `consent.{wordingVersion,reviewRequestSms,marketingSms}` wording. Submission body: `idempotencyKey` (16-64 chars, required), optional `version` (any published version of that business; default current; unknown/future -> 404), `answers[]` (`text` / `rating` 1-5 / `choiceIds`), optional `contact{fullName,email,phone}`, optional `consent{reviewRequestSms,marketingSms}` (need a valid phone; never defaulted), `website` honeypot (non-empty -> fake 201, nothing stored). Phones must be E.164 with `+`/`00` country code; emails lower-cased. Name without email/phone -> 422 (response would otherwise lose it). Responses/contacts routes are GET-only (immutable). Private routes: member access via `requireBusinessAccess`; other tenant's ids -> 404, other tenant's businessId -> 403. Rate limits (per IP, in-memory): `PUBLIC_SUBMIT_RATE_LIMIT_MAX` (10/10 min), `PUBLIC_SCAN_RATE_LIMIT_MAX` (60/10 min).

Questionnaire rules: drafts may be incomplete; publish needs title, >=1 question, non-empty labels, choice questions >=2 unique non-empty choices (422 `QUESTIONNAIRE_INVALID` with `details.issues`). Optimistic concurrency via draftRevision (409 `REVISION_CONFLICT`); unchanged -> 409 `NOTHING_TO_PUBLISH`. Publish atomically claims version number + marks revision published (concurrent publishes => one version). Versions are insert-only. Public form: any unavailable case (unknown/malformed slug, no published version, disabled business) => identical 404 `FORM_UNAVAILABLE`. QR encodes only `PUBLIC_BASE_URL/r/<slug>`; slug is immutable => permanent.

Onboarding rules (updated): steps business→questionnaire→confirm→qr; forward only one step at a time (409 STEP_NOT_AVAILABLE), back always ok; only `confirm` is client-completable (422 otherwise); moving past `questionnaire` needs a published version (409 `QUESTIONNAIRE_NOT_PUBLISHED`); publishing marks `questionnaire` done; `finish` (owner) re-checks confirm + published in the DB (409 `ONBOARDING_INCOMPLETE` `{missing}`), then sets `completedAt` and status `active`.

Auth mechanics: cookies `gdv_at` (JWT 15m, httpOnly, path /), `gdv_rt` (opaque 30d, httpOnly, path /api/v1/auth), `gdv_csrf` (readable; echoed as `X-CSRF-Token`). `csrfProtection` is mounted on `/api/v1` for all POST/PUT/PATCH/DELETE. Tenant seam: `middleware/require-business-access.ts` (inject membership lookup; deny by default) — wire in M-BIZ.

Planned (SRS §10; move rows up when built):
- POST /businesses, GET/PATCH /businesses/:id → M-BIZ
- GET /businesses/:id/questionnaire, PUT …/questionnaire/draft, POST …/questionnaire/publish → M-FORM
- GET /businesses/:id/qr → M-QR
- GET /public/:slug, POST /public/:slug/responses → M-PUB
- GET /businesses/:id/contacts[/:contactId | /export] → M-CRM
- GET /businesses/:id/responses[/:responseId] → M-RESP
- GET /businesses/:id/dashboard → M-DASH
- automations/review, messages, webhooks/sms/:provider → M-SMS
- P1: webhooks/voice, automations/missed-call, campaigns → M-CALL / M-CAMP

Conventions: Zod validate → service → `{data}` / `{data,pagination}` / `{error}`.

## Rewards (M-REWARD)
All under `/businesses/:id/...` need membership; **owner** = approve/reject/cancel/manual issue/rule writes/resolve; **member** (staff) = read, verify, redeem, record manual share. Files: `modules/rewards/{reward.model,reward.schemas,reward.service,reward.routes}.ts`.
| Route | Notes |
|---|---|
| GET rewards/templates; GET rewards/summary?days | presets; counts, redemptionRate, cost by currency (from staff-entered totals), trend |
| GET/POST reward-rules; PATCH reward-rules/:ruleId | owner writes; disable = `enabled:false` (no delete, audit kept) |
| GET incidents; POST incidents/:id/issue {ruleId?}; POST incidents/:id/resolve | owner issue/resolve; 409 `REWARD_EXISTS` |
| GET rewards (status incl. derived `expired`, search code/contact); GET rewards/:id (+history); POST rewards/:id/approve, reject, cancel {note?} | 409 `INVALID_STATE` on wrong state |
| POST rewards/:id/shared {method: copy/whatsapp_link/email_link/in_person} | records a manual share only; never claims delivery |
| POST rewards/verify {code}; POST rewards/redeem {code, requestId, orderTotal?} | per-user limiter 60/min; 201 new, 200 same requestId replay, 409 `REWARD_ALREADY_REDEEMED`/`REWARD_EXPIRED`/`REWARD_NOT_REDEEMABLE`, 422 `MIN_SPEND_NOT_MET`, 404 generic `REWARD_NOT_FOUND` |
| GET /public/rewards/:token (anonymous, no-store) | signed `<rewardId>.<hmac>` link; code hidden until approved |
| POST /public/:slug/responses | result now includes `reward` (customer view) or null |
Redemption is atomic (`issued -> redeemed` via conditional update); issuance is idempotent per response (unique index) and capped atomically (`reward_quotas`).

## Platform administration
`/api/v1/admin/*`: separate Super Admin scope, current DB role check, existing CSRF. GET dashboard/system/search; paginated GET businesses/users/forms/responses/contacts/promotions/activity and detail; business metadata/state/member management/QR; user status/session actions/memberships; form publication/archive/restore/versions; supported promotion decisions. Full contract and limits: [admin](admin.md).

- Admin PATCH users/:id/role and membership role/status PATCH now implemented; block/unblock aliases on user action POST. All unsafe actions remain CSRF-protected and Super Admin-only. See admin.md for request contracts and concurrency guarantees.

## Instant Rewards (/api/v1)

Management permission: active SUPER_ADMIN or explicit `instant_rewards:manage`. GET/POST `/instant-rewards/admin`; GET `/instant-rewards/admin/summary`, `/users`, `/:id`, `/:id/audit`; PATCH `/:id` (unsent draft with revision); POST `/:id/send`, `/resend`, `/enable`, `/disable`, `/revoke` (confirmation). Recipient: GET `/instant-rewards/mine`; POST `/view`, `/request-verification`, `/verify`, `/claim`; POST `/instant-rewards/:id/request-link`. Token-bearing inputs are POST bodies, never URL params. SUPER_ADMIN POST `/admin/users/:id/instant-reward-access` delegates/removes permission and revokes sessions. Raw signed POST `/webhooks/instant-rewards/email` is outside browser CSRF; all browser writes keep CSRF. See the spec for request/response fields and errors.

## Shared email provider (2026-10-19)

POST /api/v1/webhooks/resend is the shared raw signed webhook. /api/v1/webhooks/instant-rewards/email remains an alias. No public arbitrary-send, reset or OTP endpoint was added.

## Campaign Management Engine

M-CAMP: business `/businesses/:businessId/campaigns`, platform `/admin/campaigns`, contact campaign-profile update, bearer scheduler `/internal/campaigns/run`. Full payload/permission map: [campaigns](campaigns.md).

## Profile image and business logo (2026-10-20)

Images are raw bodies (`image/png|jpeg|webp`, <=512 KB, magic bytes sniffed, SVG rejected). Auth user DTO gains `avatarUrl`; business DTO gains `logoUrl`; public form `business.logoUrl`; all null when unset. Routes (api/src/modules/images/image.routes.ts): `GET|PUT|DELETE /users/me/avatar` (self only); `GET /businesses/:id/logo` (member), `PUT|DELETE` (owner only, 403 otherwise); `GET /public/:slug/logo` (anonymous, unavailable/suspended businesses 404, public cache); `GET /admin/users/:id/avatar` and `/admin/businesses/:id/logo` (Super Admin read-only). Admin list/detail projections add `avatarUpdatedAt`/`logoUpdatedAt`. Errors use the standard envelope: 415 UNSUPPORTED_IMAGE, 413 PAYLOAD_TOO_LARGE/IMAGE_TOO_LARGE.
