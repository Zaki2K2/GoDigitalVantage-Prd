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
