# Privileged access, audit and retention

This document describes technical controls. It is not legal advice and does not claim GDPR, UK GDPR, CCPA/CPRA, CAN-SPAM, PECR or any other certification or compliance. Retention periods below are engineering proposals that counsel must confirm per jurisdiction and contract.

## What platform administrators can and cannot do

Super Admin keeps platform operations: dashboard aggregates, business moderation, user block/unblock, session revocation, role administration, system health, audit review. Tenant customer data (contacts, responses and answers, reward codes, campaign recipients and message bodies) is default-deny. It is reachable only through an owner-approved support grant. See `.claude/brain/admin.md` for the route list.

## Session-bound re-authentication

- `POST /admin/reauth` verifies the administrator password and stores a proof for 5 minutes.
- The proof is keyed to the **session id** (`sid` claim in the access token = refresh-token family id), the user, and the user's `sessionVersion`.
- It is honoured only if: same user and same session id; not expired; account active; `sessionVersion` unchanged; the refresh family is not revoked and still has a live token.
- Consequences: another browser or device of the same account has a different family and cannot reuse it; logout, revoke-sessions, block and role change invalidate it immediately; legacy tokens without `sid` cannot re-authenticate and must sign in again.
- Failed attempts are logged; 5 failures in 15 minutes lock re-authentication for the account.

## Support grants

Checked on every protected request: caller is the grant holder; grant is `active` and unexpired; the business matches; the scope is granted; write operations need `write` mode and a fresh session-bound re-authentication (also required for the `contacts` scope); the approving owner is still an active owner of that business (emergency grants are exempt and are separately reviewed); records are looked up inside the grant business only, so IDs from another tenant return 404.

A support grant never authorises marketing. Platform-owned campaigns have a separate `ownerApproval` that only a business owner can set. Without an approval of `approved`, campaigns are not scheduled, activated, resumed or delivered, including already-composed pending recipients. Rejection takes effect before the next recipient. Editing a draft clears approval. Platform staff cannot hand-pick customers (`audience.type = selected` is rejected). Consent, suppression and unsubscribe checks (`marketingAllowed`) still run before every send.

### Legacy platform campaigns

Campaigns created before the approval field have none and are treated as unapproved: nothing is deleted, nothing sends. Review them with:

```powershell
npm --prefix apps/api run campaigns:audit-legacy -- DATABASE_NAME
```

The report is read-only and contains ids and counts only. `GET /api/v1/admin/campaigns/owner-review` returns the same queue to Super Admins. Each business owner can approve or reject in the existing campaign view (`POST /businesses/:id/campaigns/:campaignId/owner-approval`). Operators should notify owners of flagged campaigns; the platform cannot approve on their behalf.

## MongoDB configuration for the append-only audit log

The application enforces append-only behaviour on `support_access_log` through Mongoose hooks (no update, replace or delete, and no re-save of existing documents). Hooks do not stop a compromised application process or a direct database connection, so production must also enforce it with database roles.

1. Enable MongoDB authorization. Never run production with an unauthenticated connection.
2. Give the application a role with no admin privileges and, on `support_access_log` only, `insert` and `find`. It must not have `update`, `remove`, `dropCollection`, `renameCollectionSameDB`, `collMod` or `dropIndex` there.
3. Keep `createIndex` for the log with the migration/operator role, not the runtime role. Create indexes during deployment (`autoIndex` off in production).
4. Use a separate break-glass DBA role for retention actions, with its own credentials held outside the application.
5. Enable database audit logging and backups; restrict backup access as it contains the same personal data.

Example role (adjust the database name):

```javascript
db.createRole({
  role: 'gdvAuditAppend',
  privileges: [
    { resource: { db: 'DB', collection: 'support_access_log' }, actions: ['insert', 'find'] },
  ],
  roles: [],
});
```

Grant the runtime user `readWrite` on every other collection by privilege, not by the built-in `readWrite` role on the whole database (that would include `update`/`remove` on the log). `admin_audit` records are updated from `pending` to `completed`/`failed` by design, so it cannot be insert-only; protect it with the same least-privilege approach and keep backups.

Verify with the read-only check (it inspects privileges, performs no writes):

```powershell
npm --prefix apps/api run security:check-audit-permissions -- DATABASE_NAME
```

Exit 0 = OK, 1 = excessive privileges, 2 = unverified (unauthenticated connection, such as local `gdv_test`).

## Retention and cleanup

| Data | Proposed retention | Cleanup |
|---|---|---|
| `admin_reauth` proofs | 5 minutes | Automatic TTL index. |
| Grants that never became active (denied, cancelled, unapproved) | 12 months, then removable | `npm run support:retention -- DB` reports; `--apply` removes only these. Emergency grants are never removed. |
| Activated grants (including emergency) | At least 36 months, then review | Report only. Never auto-deleted. Preserve while any incident, dispute or legal hold is open. |
| `support_access_log` | At least 36 months, then review | Application never deletes it. Purge only by a DBA-run process after legal-hold review. |
| `admin_audit` | Same as the log | Same. |
| Historical `campaign_recipients` (hold email, subject, body) | Set by the controller of the data | Not changed by this work. Decide a limit and a purge job; keep suppression and consent evidence longer than message bodies. |

The log stores ids, event codes and route templates only (no query strings, bodies or customer data), which keeps long retention proportionate. Honour erasure requests for customer data through the business owner's tooling; the log does not contain it. Do not shorten periods below any legal minimum that applies to your contracts.
