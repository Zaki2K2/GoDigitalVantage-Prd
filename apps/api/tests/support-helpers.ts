import type { Types } from 'mongoose';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import {
  AdminReauth,
  SupportGrant,
  type SupportMode,
  type SupportScope,
} from '../src/modules/admin/support.model';

/** Seeds an owner-approved grant directly (the approval flow itself is covered in privacy tests). */
export async function activeGrant(
  adminId: string | Types.ObjectId,
  businessId: string | Types.ObjectId,
  scopes: SupportScope[],
  mode: SupportMode = 'read',
  expiresInMs = 60 * 60_000,
) {
  const now = Date.now();
  const owner = await BusinessMembership.findOne({ businessId, role: 'owner' }).lean();
  return SupportGrant.create({
    approvedBy: owner?.userId ?? null,
    businessId,
    requestedBy: adminId,
    ticketRef: 'TICKET-1',
    reason: 'Customer asked support to look into an issue',
    scopes,
    mode,
    durationMinutes: 60,
    status: 'active',
    requestExpiresAt: new Date(now + 3_600_000),
    approvedAt: new Date(now),
    expiresAt: new Date(now + expiresInMs),
    review: { status: 'not_required' },
  });
}

/** Seeds a proof for an exact session (refresh-token family). */
export async function reauth(
  adminId: string | Types.ObjectId,
  sessionId: string,
  sessionVersion = 0,
  ttlMs = 5 * 60_000,
) {
  await AdminReauth.create({
    userId: adminId,
    sessionId,
    sessionVersion,
    expiresAt: new Date(Date.now() + ttlMs),
  });
}

/** Creates the refresh-token family a signed access token claims as its session. */
export async function seedSession(userId: string | Types.ObjectId, sessionId: string) {
  await RefreshToken.create({
    userId,
    familyId: sessionId,
    tokenHash: sessionId,
    sessionVersion: 0,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}
