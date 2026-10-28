import type { Request } from 'express';
import { Types } from 'mongoose';
import { User } from '../auth/user.model';
import { AppError, forbidden } from '../../shared/errors';
import { AdminReauth, SupportAccessLog, SupportGrant, type SupportScope } from './support.model';

export const REAUTH_TTL_MS = 5 * 60_000;
export const MAX_GRANT_MINUTES = 24 * 60;
export const MAX_EMERGENCY_MINUTES = 60;
export const REQUEST_TTL_MS = 72 * 3_600_000;

type LogInput = {
  actorUserId: string;
  actorRole?: string;
  businessId?: string | Types.ObjectId | null;
  grantId?: string | Types.ObjectId | null;
  event: string;
  outcome: 'allowed' | 'denied';
  reason?: string;
  scope?: SupportScope;
  operation?: string;
  route?: string;
  ticketRef?: string;
};

/** Identifiers and codes only. Callers must never pass request bodies, query strings or PII. */
export async function logAccess(entry: LogInput) {
  await SupportAccessLog.create(entry);
}

/** Route template only (never req.url): query strings can carry search terms or identifiers. */
export function routeOf(req: Request) {
  return `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`
    .replace(/[a-f\d]{24}/gi, ':id')
    .slice(0, 120);
}

export type GrantLike = {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  scopes: string[];
  mode: string;
  status: string;
  expiresAt?: Date | null;
  ticketRef: string;
  emergency?: boolean;
};

export const isLive = (g: Pick<GrantLike, 'status' | 'expiresAt'>, now = new Date()) =>
  g.status === 'active' && !!g.expiresAt && g.expiresAt.getTime() > now.getTime();

export function effectiveStatus(g: {
  status: string;
  expiresAt?: Date | null;
  requestExpiresAt?: Date;
}) {
  const now = Date.now();
  if (g.status === 'active' && g.expiresAt && g.expiresAt.getTime() <= now) return 'expired';
  if (g.status === 'pending' && g.requestExpiresAt && g.requestExpiresAt.getTime() <= now)
    return 'expired';
  return g.status;
}

export async function hasRecentReauth(userId: string) {
  const [user, proof] = await Promise.all([
    User.findById(userId, { sessionVersion: 1 }).lean(),
    AdminReauth.findOne({ userId, expiresAt: { $gt: new Date() } })
      .sort({ expiresAt: -1 })
      .lean(),
  ]);
  return !!user && !!proof && (proof.sessionVersion ?? 0) === (user.sessionVersion ?? 0);
}

type Need = { scope: SupportScope; operation: 'read' | 'write' };
const HIGH_RISK_SCOPES: SupportScope[] = ['contacts'];

/**
 * Default-deny gate for tenant-owned data. Returns the grant only when it belongs to the caller,
 * is approved, unexpired, unrevoked, covers the scope and (for writes) was granted write mode.
 * Every decision, including refusals, is written to the append-only log.
 */
export async function authorizeGrant(
  req: Request,
  grantId: string,
  need: Need,
  businessId?: string,
) {
  const actor = req.auth!.userId;
  const deny = async (reason: string, grant?: GrantLike | null): Promise<never> => {
    await logAccess({
      actorUserId: actor,
      actorRole: 'SUPER_ADMIN',
      businessId: grant?.businessId ?? businessId ?? null,
      grantId: grant?._id ?? null,
      event: 'DATA_ACCESS',
      outcome: 'denied',
      reason,
      scope: need.scope,
      operation: need.operation,
      route: routeOf(req),
    });
    throw forbidden('Support access is not authorized for this request');
  };
  if (!Types.ObjectId.isValid(grantId)) return deny('GRANT_INVALID');
  const grant = (await SupportGrant.findById(grantId).lean()) as GrantLike | null;
  if (!grant) return deny('GRANT_NOT_FOUND');
  if (String(grant.requestedBy) !== actor) return deny('GRANT_NOT_HOLDER', grant);
  if (businessId && String(grant.businessId) !== businessId)
    return deny('GRANT_WRONG_BUSINESS', grant);
  if (!isLive(grant))
    return deny(
      grant.status === 'active' ? 'GRANT_EXPIRED' : `GRANT_${grant.status.toUpperCase()}`,
      grant,
    );
  if (!grant.scopes.includes(need.scope)) return deny('SCOPE_NOT_GRANTED', grant);
  if (need.operation === 'write' && grant.mode !== 'write') return deny('READ_ONLY_GRANT', grant);
  if (
    (need.operation === 'write' || HIGH_RISK_SCOPES.includes(need.scope)) &&
    !(await hasRecentReauth(actor))
  )
    return deny('REAUTH_REQUIRED', grant);
  await logAccess({
    actorUserId: actor,
    actorRole: 'SUPER_ADMIN',
    businessId: grant.businessId,
    grantId: grant._id,
    event: 'DATA_ACCESS',
    outcome: 'allowed',
    scope: need.scope,
    operation: need.operation,
    route: routeOf(req),
    ticketRef: grant.ticketRef,
  });
  return grant;
}

/** Used by routes that act on a business without a grant id in the URL (platform campaigns). */
export async function authorizeBusinessWrite(
  req: Request,
  businessId: string,
  scope: SupportScope,
) {
  const grants = (await SupportGrant.find({
    businessId,
    requestedBy: req.auth!.userId,
    status: 'active',
    expiresAt: { $gt: new Date() },
    mode: 'write',
    scopes: scope,
  }).lean()) as unknown as GrantLike[];
  const grant = grants[0];
  if (!grant) {
    await logAccess({
      actorUserId: req.auth!.userId,
      actorRole: 'SUPER_ADMIN',
      businessId,
      event: 'DATA_ACCESS',
      outcome: 'denied',
      reason: 'NO_ACTIVE_WRITE_GRANT',
      scope,
      operation: 'write',
      route: routeOf(req),
    });
    throw new AppError(
      403,
      'SUPPORT_GRANT_REQUIRED',
      'An active business-approved write grant is required for this action',
    );
  }
  return authorizeGrant(req, String(grant._id), { scope, operation: 'write' }, businessId);
}
