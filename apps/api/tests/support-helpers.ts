import type { Types } from 'mongoose';
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
  return SupportGrant.create({
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

export async function reauth(adminId: string | Types.ObjectId, sessionVersion = 0) {
  await AdminReauth.create({
    userId: adminId,
    sessionVersion,
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
}
