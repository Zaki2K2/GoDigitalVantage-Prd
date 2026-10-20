# Change impact (if X changes → check Y)
- `config/env.ts` → every module importing `env`, `.env.example`, `vitest.config.mts` env, CLAUDE.md commands.
- `shared/errors.ts`, `middleware/error-handler.ts` → all controllers; web error handling (core interceptor).
- `app.ts` (middleware order/routers) → all routes; register new routers here + [api-map](api-map.md).
- Cookie names/paths (`modules/auth/cookies.ts`) → web `CSRF_COOKIE_NAME`/XSRF config, proxy, auth tests.
- Auth middleware (M-AUTH) → every private route; web `core/` interceptor + guard.
- `requireBusinessAccess` (M-BIZ) → all `/businesses/:id/*` routes + tenant-isolation tests.
- Questionnaire version schema (M-FORM) → public form (`getPublicForm`), M-RESP snapshot (question/choice ids are stable: responses must store ids + label snapshots), builder UI, `publishIssues`.
- Business `slug` / `PUBLIC_APP_BASE_URL` (legacy `PUBLIC_BASE_URL` fallback) → QR URLs customers have already printed (slug must stay immutable; origin must stay reachable). Check env schema, QR tests, and local-development instructions.
- `finishOnboarding` / onboarding rules → wizard guards, `onboardedGuard`, [api-map](api-map.md).
- Response/contact schemas → M-CRM matching, M-DASH aggregates, CSV export, [database](database.md).
- Consent model → M-SMS eligibility, M-CAMP recipients, CSV export, public form wording.
- sms_messages status enum → worker, webhook handler, dashboard cards, automations UI.
- Any API route/DTO → [api-map](api-map.md) + consuming web service.
- `submission.service.ts` / `response.model.ts` (answer snapshot shape) → response detail UI, dashboard rating average, contact detail, CSV export (later), `submission.test.ts`.
- `contact.service.ts` (`CONSENT_WORDING_VERSION`, `consentWording`, `upsertContact`) → public form consent text (served by `GET /public/:slug`), consent_events, M4 SMS eligibility (`consent.reviewRequestSms`), contact tests. Changing wording requires bumping the version.
- `qr/scan.service.ts` (dedupe window, visitor hash, crawler list) → `qr_events` index, dashboard scan counts, privacy notes in decisions.
- `public.routes.ts` limiters/env (`PUBLIC_*_RATE_LIMIT_MAX`) → `vitest.config.mts` env (25) + rate-limit test, `.env.example`.
- `dashboard.service.ts` → `DashboardPage`, `Dashboard` type in `feedback.service.ts`.
- Reward rule/reward schema (`reward.model.ts`) or `processSubmission` -> submission result `reward`, thank-you page, redeem rules, summary aggregation, `rewards.test.ts`, [database](database.md). Rule snapshots mean old rewards keep old terms.
- `submitResponse` signature (client ip/UA) -> identity hash for anonymous cooldown; behind a proxy set `trust proxy` or all anonymous customers share one cooldown identity.
- Code format/normalisation (`newCode`, `normalizeCode`) -> verify/redeem UI input, search, customer card.
- Any change to the shell nav/routes/icon sprite must keep the `/rewards` entries (another session edits these files too).

- Platform role/session cutoff or business/member/form moderation changes -> `modules/admin/*`, auth middleware, membership lookup, public form resolution, admin guard/shell, normal auth/business/form/QR tests. See [admin](admin.md).

- Session version -> auth issuance/refresh, requireAuth, admin block/revoke/role actions, auth and admin permission tests. Business owner role/removal -> admin mutation locks, primary owner pointer, live membership lookup and tenant/concurrency tests.

## Instant Rewards (2026-10-19)

Adds isolated collections/module/UI and optional email configuration. Auth DTO adds safe permissions; existing cookie/session-version/CSRF behavior stays authoritative. Admin user permission changes use existing mutation lock/audit and revoke sessions. Browser reward token API calls use POST/no-store/no-referrer; signed provider webhook is deliberately raw-body before JSON/CSRF middleware. New frontend routes precede generic admin sections. Existing feedback rewards and tenant authorization remain separate. Configure verified sender, secret and signed webhook before production email; see docs/instant-rewards-operations.md.

## Shared email provider (2026-10-19)

Email provider migration affects env validation/examples, modules/email, reward email composition/receipt reconciliation, signed webhook aliases and provider tests. No UI redesign, auth route change or secret rotation. Deployment instructions: docs/email-resend.md.

## Restricted email testing

Restricted email testing changes env schema/examples and shared adapter only, plus provider/reward safety tests. Shared templates, signed webhook routes and reward security remain unchanged. Production mode retains verified-domain gate; see docs/specs/email-provider.md and docs/email-resend.md.

## Campaign Management Engine

Campaign changes must preserve tenant audience/cursor intersection, unique recipient/window keys, provider payload/idempotency stability, durable locks, immutable scheduled configuration and existing reward redemption. Required production migration/configuration: [campaigns](campaigns.md).


Shared dropdowns: changing AppSelect/SelectControl/ActionMenu/DropdownPanel affects all 28 selects, editable BusinessForm suggestions, Admin/Campaign/account menus and modal focus. Check shared dropdown regressions plus existing questionnaire type changes, reward numeric ngValue, business switching, consent, filters/sorting and Admin/Campaign confirmations. See [dropdowns](dropdowns.md).

Mongo connection cache/pool or Vercel entry/config changes -> serverless, db-cache, performance, auth, tenant/moderation and campaign tests. Preserve live permission reads and explicit production migrations. Timing logs must remain free of request/DB values. See [performance](performance.md) for measured baseline and account-access limitations.

## Profile image and business logo (2026-10-20)

Image DTO fields (`avatarUrl`/`logoUrl`) -> `toUserDto`, `toBusinessDto`, `getPublicForm`, web `AuthUser`/`Business`/`PublicForm` types, exact-payload tests in questionnaire/submission tests. Size or type limits (`MAX_IMAGE_BYTES`, `IMAGE_CONTENT_TYPES`) -> `image-resize.ts` (client limits) and the `express.raw` parser in `image.routes.ts`. Logo permission changes -> `requireBusinessAccess`, owner check in image routes, public slug route. Admin projections -> `admin.service.ts` fields and `record-details.ts` hidden keys. See `apps/api/tests/images.test.ts`.
