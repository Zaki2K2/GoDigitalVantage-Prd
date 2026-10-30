# Platform administration (M-ADMIN)

Entry: `/admin/dashboard`, authenticated `SUPER_ADMIN` only. Uses the existing AppShell, BrandLogo, Icon, BusinessForm, QuestionnaireFormView, shared semantic styles, and DialogFocus. RecordDetails is a reusable, read-only structured inspector. Business onboarding is not required to enter admin.

## Access

Register a normal account first. Bootstrap the first administrator using the operator command:

```powershell
# Select the intended LOCAL database explicitly; do not accidentally grant in a remote environment.
$env:MONGODB_URI='mongodb://127.0.0.1:27017/godigitalvantage'
npm --prefix apps/api run admin:grant -- admin@example.com --confirm-super-admin
```

Restart/sign in again and visit `/admin`. No default admin/password or registration privilege escalation. The command uses the API process environment and existing `.env` validation. It records the grant as an operator action. Production grants must be run deliberately by the database/environment operator.

## UI and API

All endpoints below are under `/api/v1/admin`, behind CSRF for unsafe methods, requireAuth and the centralized requireSuperAdmin guard. GET responses are `Cache-Control: no-store`. Existing tenant endpoints never bypass membership for administrators.

- GET dashboard: real counts and average first feedback rating; time buckets explicitly UTC.
- GET system: environment, API version, database connectivity, rate-limit store type; no configuration secrets.
- GET search: up to five results per entity (businesses/users/forms/contacts/responses).
- GET businesses/users/forms/responses/contacts/promotions/activity: `{data,pagination}`, bounded page/pageSize (max 100), escaped search, dates, deterministic sorting, resource filters. Inclusion projections prevent accidental secret disclosure.
- GET each resource/:id: safe detail; businesses include owner and indexed related counts; users include membership count; responses include linked promotion.
- PATCH businesses/:id: existing metadata validation, immutable slug/owner excluded.
- POST businesses/:id/state `{state: active|suspended|archived,confirm:true}`: independent moderation state; preserves onboarding; restoring legacy disabled businesses derives active/onboarding from completedAt.
- GET businesses/:id/members and users/:id/memberships: paginated, date/search filtered, joined safe identity/business fields.
- PATCH businesses/:id/members/:memberId accepts exactly one of `{status:active|disabled,confirm:true}` or `{role:owner|member,confirm:true}`; DELETE same with `{confirm:true}` removes business access. Another active owner must remain before removing, disabling or demoting an owner. Primary ownerUserId is updated first when needed.
- GET businesses/:id/qr and qr.svg/qr.png: existing local QR renderer and configured public app origin; slug remains permanent.
- GET forms/:id/versions: immutable published content, pagination/search/dates.
- POST forms/:id/publish `{confirm:true,expectedRevision}`: reuses existing publication validation and optimistic revision handling.
- POST forms/:id/archive or restore `{confirm:true}`: moderation flag hides public forms without deleting versions/responses.
- POST users/:id/action `{action:block|unblock|revoke-sessions,confirm:true}` (enable/disable aliases retained): block and revoke increment the session version and revoke refresh families. Other Super Admin accounts may be managed; self-block/revocation is forbidden.
- PATCH users/:id/role `{platformRole:USER|SUPER_ADMIN,confirm:true}`: only an existing active Super Admin can change another account. Self-role changes are forbidden, promoting disabled accounts is rejected, and old sessions are revoked.
- POST promotions/:id/approve|reject|cancel `{confirm:true,note?}`: delegates to existing reward transitions and reward audit; no bypass of reward states.

URL state: search, status, dates, role, businessId, onboarding, rating, questionnaireId, sort/direction, page, detail tab. Debounced search and cancellation prevent stale lists. Activity additionally accepts actorUserId/action/entity. Details offer a read-only preview with explicit administrator context; no impersonated credentials/sessions.

## Data and security

- users.platformRole: USER (legacy fallback) or SUPER_ADMIN. users.sessionVersion: monotonically increasing immediate access/refresh revocation boundary, default 0 for legacy accounts. users.sessionsRevokedAt remains the timestamp cutoff for legacy unversioned tokens.
- businesses.adminState: active (legacy fallback), suspended, archived. Membership lookup denies moderated businesses; public form/scan/submission lookup denies them too. Reactivation never completes onboarding.
- business_memberships.status: active (legacy fallback), disabled. Owner/member roles are managed under a per-business mutation lock. The last active owner cannot be removed, disabled or demoted.
- questionnaires.adminArchived: false by default; archive blocks all public versions, not just latest. Publishing does not clear moderation.
- admin_audit: actor identity snapshot, actorRole, businessId, entity/targetId, action, safe before/after, at, outcome. No audit edit/delete API. Durable intent is inserted before mutation; audit insertion failure prevents the write. Completed is set after mutation. A crash can leave pending (outcome unknown), which must not be interpreted as success; multi-document operations are not transactional on standalone MongoDB. Reward/form rejected transitions are marked failed.
- Indexes: global timestamp/_id ordering on supported entity collections; business moderation/date; audit global, business/date and actor/date. Existing tenant indexes remain. Related counts and enrichment are batched for the current page; no client pagination or platform-sized ID arrays.
- requireAuth checks current account status and session version (legacy timestamp cutoff where applicable) on every private request; cookie attributes, CSRF, refresh rotation/reuse handling and existing rate limiters remain intact.
- No passwords, refresh/access token values, identity hashes, integration credentials, or connection strings in admin DTOs. No registration role assignment. Platform privilege changes require an authenticated Super Admin and explicit confirmation.

## Deliberate limits

Projects/tasks/files/time tracking, subscriptions, invitations, external integrations and import jobs have no implementation in this repo; no fake metrics or dead navigation. Business roles remain owner/member. Role changes and primary ownership reassignment preserve at least one active owner using durable per-business serialization on standalone MongoDB. No destructive entity deletion. Full historical application-event ingestion is not retroactively invented: Activity records admin operations; existing reward audit remains in its module. No CSV export or promotion-rule/incident authoring from admin yet; bounded services/projections can support an authorized streaming export later. Promotion terms remain immutable; only supported reward decisions are exposed. Read-only business/form inspection replaces credential impersonation.

## Verification and impact

Admin API tests cover authorization, projection safety, current-role revocation, validation, pagination, search/filtering, tenant boundaries, moderation/restoration, CSRF, metadata allowlists, session revocation, owner protection, membership state, fail-closed audit writes, form revision/archive/restore and QR formats. UI tests cover guard/navigation, loading/empty/error/retry, URL restoration, debounce/cancellation, confirmation, tabs and business scoping. Existing auth/business/form/QR/reward flows must remain green. Browser review uses a separate local `gdv_admin_preview` database, not production.

Super Admin landing: `/`, authenticated login/register, and business onboarding/deep links redirect to `/admin` without requesting tenant onboarding. Login preserves admin return links but discards stale business/onboarding return paths for Super Admins. The admin shell home link targets `/admin` and omits business setup links. Normal business-user onboarding is unchanged.

Admin tables use compact shared styling, one-line action groups, merged business moderation/status badges, split owner identity lines, shorter count headings and separate date/time display. Row overflow actions open a fixed floating menu outside the scrolling table, support keyboard navigation and Escape/focus return, and preserve confirmation for sensitive actions.

Administrative mutation serialization: `admin_mutation_locks` uses unique scope keys (`platform-users` and `business:<id>`), with an audit-intent token and acquisition time. User administration is serialized globally and actor privileges are rechecked after lock acquisition to prevent two admins disabling/demoting each other concurrently. Membership operations serialize per business. Successful and failed actions update audit outcomes and release their exact lock token. Completed/failed intent locks may be reclaimed safely. Pending/unknown intents have no TTL and fail closed with 409 ADMIN_ACTION_IN_PROGRESS; an operator must inspect the referenced audit and reconcile any partial writes before manually clearing an abandoned pending lock. This deliberately avoids claiming multi-document rollback on standalone MongoDB.

UI actions are available on user lists/details and both business-member and user-membership tabs. Membership URLs always use the row businessId, not the currently inspected user ID. The existing confirmation, errors/success feedback, controls and styling remain. Existing ordinary tenant access still uses live active membership and business-state checks.

Administrative ObjectIds and authenticated subjects are canonicalized to lowercase, so alternate-case IDs cannot bypass self-protection or create separate lock scopes for one business. Regression tests cover case variants, real login/access/refresh lifecycles, CSRF on POST/PATCH/DELETE, cross-tenant preservation and concurrent owner/admin changes.

- Dashboard presentation: AdminDashboard receives existing API metrics and rating, with four primary totals, business-health progress, a rating/empty panel, contextual moderation links, grouped supporting metrics and operational shortcuts. It uses the existing design system and contains no fabricated trend data.

## Instant Rewards permission

Super Admin manages `/admin/instant-rewards` and delegates `instant_rewards:manage` from user details via the existing confirmation/audit flow. Delegated active users use `/rewards-admin` and `/api/v1/instant-rewards/admin`; this grants no other `/api/v1/admin` or tenant API access. Grant/removal revokes existing sessions; self-changes are prohibited. Reward recipients use `/my-rewards` without onboarding and must prove ownership via emailed tokens. Lifecycle and successful-action audit are atomic; see the Instant Rewards specification and operations guide.

## Live bootstrap verification (2026-10-19)

Created the requested active Super Admin account through the live application and granted SUPER_ADMIN with the existing audited operator command. Live frontend login and /api/v1/admin/system both returned 200; grant audit completed; all verification refresh sessions were confirmed revoked after logout. Do not store bootstrap passwords in documentation.

Important environment discrepancy: the live API currently uses MongoDB database `test`, while the local `.env.production` connection selects `godigitalvantage`. Exact live registration identity was matched before the real grant. The initial unused bootstrap account in `godigitalvantage` was disabled, demoted and had sessions revoked with an operator correction audit; no existing tenant data was removed. Confirm actual deployed database before future operator actions; do not rely on the env filename. The live system endpoint reports environment `development`; no Vercel configuration, secrets or deployment was changed during account creation.

## Privacy-first Super Admin (2026-10-28)

Super Admin is a platform operator, not a data viewer. Tenant customer data (contacts, individual responses/answers, reward codes and recipients, campaign recipients/message bodies) is **default-deny** for platform admins.

- `admin.service.ts`: `PLATFORM_RESOURCES` (businesses, users, forms, activity) vs `RESTRICTED_RESOURCES` (responses, contacts, promotions). `list`/`detail` throw 403 for restricted resources unless a `GrantContext` is passed (only the support-grant layer does). Activity `before/after` are redacted on output.
- `/admin/responses|contacts|promotions[/*]` are refused with `403 CUSTOMER_DATA_RESTRICTED` and a denied `support_access_log` entry. `/admin/search` returns businesses/users/forms only. Campaign monitoring and platform campaign detail return no contact ids, provider ids, emails, subjects or bodies.
- Support access (`support.model.ts`, `support-access.ts`, `support.routes.ts`): `support_grants` (pending -> owner approves -> active until `expiresAt`; deny/revoke/cancel; computed `expired`), scopes `business_profile|forms|responses|contacts|rewards|campaigns`, mode `read` (default) or `write`. Owner side: `/businesses/:id/support-grants` (owner role only; write grants need owner password). Admin side: `POST /admin/support-grants` (ticket + reason), `/admin/support/:grantId/{responses,contacts,rewards}` (page size <= 25, forced to the grant business), writes: `PATCH /admin/businesses/:id` and platform campaign mutations need an active write grant; form publish and reward decisions only via `/admin/support/:grantId/...`.
- Reauth: `POST /admin/reauth` (password, 5 min, bound to sessionVersion, lockout after 5 failures/15 min) required for write operations and the `contacts` scope.
- Emergency: `POST /admin/support-grants/emergency` needs the separate `support:emergency` user permission (granted by `POST /admin/users/:id/emergency-access`), reauth, justification >= 40 chars, read-only, max 60 min; owner sees it and can revoke; a different Super Admin must review (`/review`).
- `support_access_log`: append-only (model hooks block update/delete; production DB roles should also deny them). Stores ids/codes/route templates only, never query strings, bodies or PII. Records allowed and denied attempts.
- Unchanged: block/unblock, session revocation, role admin, business suspend/restore/archive, form archive/restore moderation, member admin, QR, system, dashboard counts. Instant Rewards remains a platform-run program (see risks in the delivery notes).

### Hardening (2026-10-28, second pass)

- Re-auth is session-bound: access tokens carry `sid` (refresh-token family id; `signAccessToken(userId, version, sid)`, `req.auth.sessionId`). `admin_reauth` stores `sessionId`; `hasRecentReauth(userId, sessionId)` requires same session, <= 5 min, active account, unchanged `sessionVersion`, and a live (unrevoked) family. Legacy tokens without `sid` cannot re-authenticate. Other devices, logout, revoke-sessions and blocking invalidate it immediately.
- Grants also require the approving owner to still be an active owner (`APPROVER_NOT_OWNER`); emergency grants are exempt (second-admin review).
- Platform campaigns: `campaigns.ownerApproval {status: pending|approved|rejected}` set only by the owner (`POST /businesses/:id/campaigns/:cid/owner-approval`). Missing = unapproved (legacy). Required to schedule/activate/resume and re-checked before each recipient and before every provider send; draft edits clear it; platform audiences cannot be hand-picked (`AUDIENCE_NOT_ALLOWED`). A support grant never implies approval. Review queue: `GET /admin/campaigns/owner-review`, CLI `npm run campaigns:audit-legacy -- DB` (read-only, ids/counts only).
- Ops tooling (all take an explicit DB name): `security:check-audit-permissions` (read-only privilege inspection), `support:retention` (report; `--apply` removes only never-activated, non-emergency grants older than 12 months; never touches `support_access_log`). Policy and MongoDB role guidance: [docs/security/privileged-access.md](../../docs/security/privileged-access.md).
- Tests: `privacy-admin.test.ts` (session isolation, escalation, cross-tenant), `support-retention.test.ts`, platform-campaign tests in `campaigns.test.ts` (Date frozen with `vi.useFakeTimers({toFake:['Date']})` at the fixed fixture instant; the six former failures were wall-clock drift, not logic).
- Known gap: granted data is readable through API routes only; there is no admin UI viewer for granted records yet.
