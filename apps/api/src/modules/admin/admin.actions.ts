import { Schema, model, Types } from 'mongoose';
import { User } from '../auth/user.model';
import { RefreshToken } from '../auth/refresh-token.model';
import { Business } from '../businesses/business.model';
import { BusinessMembership, type MembershipRole } from '../businesses/membership.model';
import { AppError, forbidden, notFound } from '../../shared/errors';
import { audit } from './admin.service';
import { AdminAudit } from './admin.model';

// Durable serialization works on local standalone MongoDB as well as replicas.
// No TTL: an uncertain/crashed ownership mutation must fail closed, never unlock mid-write.
const lockSchema = new Schema(
  {
    _id: { type: String, required: true },
    token: { type: Schema.Types.ObjectId, default: null },
    acquiredAt: { type: Date, default: null },
  },
  { collection: 'admin_mutation_locks' },
);
export const AdminMutationLock = model('AdminMutationLock', lockSchema);

interface Mutation {
  actorId: string;
  scope: string;
  entity: string;
  targetId: string;
  action: string;
  businessId?: string;
  after: Record<string, unknown>;
}
async function mutate<T>(
  input: Mutation,
  write: (
    record: (before: Record<string, unknown>, after?: Record<string, unknown>) => Promise<void>,
  ) => Promise<T>,
) {
  const log = await audit(
    input.actorId,
    input.entity,
    input.targetId,
    input.action,
    null,
    input.after,
    input.businessId,
  );
  let locked = false;
  try {
    try {
      await AdminMutationLock.updateOne(
        { _id: input.scope },
        { $setOnInsert: { token: null } },
        { upsert: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    const previous = await AdminMutationLock.findById(input.scope).lean();
    if (
      previous?.token &&
      (await AdminAudit.exists({ _id: previous.token, outcome: { $in: ['completed', 'failed'] } }))
    ) {
      // Completed/failed handlers can only have lock release left; a pending intent is never reclaimed.
      await AdminMutationLock.updateOne(
        { _id: input.scope, token: previous.token },
        { token: null, acquiredAt: null },
      );
    }
    locked = !!(await AdminMutationLock.findOneAndUpdate(
      { _id: input.scope, token: null },
      { token: log._id, acquiredAt: new Date() },
    ));
    if (!locked)
      throw new AppError(
        409,
        'ADMIN_ACTION_IN_PROGRESS',
        'Another administrative action is in progress. Retry shortly.',
      );
    // A different admin may have blocked/demoted the actor while this request waited.
    const actor = await User.findById(input.actorId, { status: 1, platformRole: 1 }).lean();
    if (actor?.status !== 'active' || actor.platformRole !== 'SUPER_ADMIN')
      throw forbidden('Super Admin access required');
    const value = await write(async (before, after = input.after) => {
      await log.updateOne({ before, after });
    });
    await log.updateOne({ outcome: 'completed' });
    return value;
  } catch (err) {
    await log.updateOne({ outcome: 'failed' });
    throw err;
  } finally {
    if (locked)
      await AdminMutationLock.updateOne(
        { _id: input.scope, token: log._id },
        { token: null, acquiredAt: null },
      );
  }
}

/** One atomic version increment invalidates both token kinds, even if family cleanup fails. */
export async function revokeSessions(
  userId: string,
  status?: 'active' | 'disabled',
  platformRole?: 'USER' | 'SUPER_ADMIN',
) {
  const result = await User.updateOne(
    { _id: userId },
    {
      $inc: { sessionVersion: 1 },
      $set: {
        sessionsRevokedAt: new Date(),
        ...(status ? { status } : {}),
        ...(platformRole ? { platformRole } : {}),
      },
    },
  );
  if (!result.matchedCount) throw notFound('User not found');
  await RefreshToken.updateMany({ userId }, { revokedAt: new Date(), familyRevoked: true });
}
export async function userAction(
  actorId: string,
  targetId: string,
  action: 'enable' | 'disable' | 'revoke-sessions',
) {
  return mutate(
    {
      actorId,
      targetId,
      scope: 'platform-users',
      entity: 'users',
      action: `USER_${action.toUpperCase().replaceAll('-', '_')}`,
      after: { action },
    },
    async (record) => {
      const target = await User.findById(targetId).lean();
      if (!target) throw notFound('User not found');
      if (actorId === targetId)
        throw new AppError(
          409,
          'SELF_PROTECTED',
          'You cannot block or revoke your own administrator account',
        );
      await record({ status: target.status, platformRole: target.platformRole ?? 'USER' });
      if (action === 'enable') await User.updateOne({ _id: targetId }, { status: 'active' });
      else await revokeSessions(targetId, action === 'disable' ? 'disabled' : undefined);
      return { success: true };
    },
  );
}
export async function platformRole(
  actorId: string,
  targetId: string,
  role: 'USER' | 'SUPER_ADMIN',
) {
  return mutate(
    {
      actorId,
      targetId,
      scope: 'platform-users',
      entity: 'users',
      action: 'PLATFORM_ROLE_CHANGED',
      after: { platformRole: role },
    },
    async (record) => {
      const target = await User.findById(targetId).lean();
      if (!target) throw notFound('User not found');
      if (actorId === targetId)
        throw new AppError(409, 'SELF_PROTECTED', 'You cannot change your own platform role');
      if (role === 'SUPER_ADMIN' && target.status !== 'active')
        throw new AppError(
          409,
          'USER_DISABLED',
          'Unblock the user before granting Super Admin access',
        );
      await record({ platformRole: target.platformRole ?? 'USER' });
      await revokeSessions(targetId, undefined, role);
      return { success: true };
    },
  );
}
export async function membershipAction(
  actorId: string,
  businessId: string,
  memberId: string,
  change: { status?: 'active' | 'disabled'; role?: MembershipRole; remove?: boolean },
) {
  const action = change.remove
    ? 'MEMBERSHIP_REMOVED'
    : change.role
      ? 'BUSINESS_ROLE_CHANGED'
      : 'MEMBERSHIP_STATUS_CHANGED';
  return mutate(
    {
      actorId,
      businessId,
      targetId: memberId,
      scope: `business:${businessId}`,
      entity: 'memberships',
      action,
      after: change,
    },
    async (record) => {
      const [business, member] = await Promise.all([
        Business.findById(businessId).lean(),
        BusinessMembership.findOne({ _id: memberId, businessId }).lean(),
      ]);
      if (!business || !member) throw notFound('Business membership not found');
      await record({
        userId: member.userId,
        role: member.role,
        status: member.status ?? 'active',
        ownerUserId: business.ownerUserId,
      });
      if (change.role === 'owner') {
        const user = await User.findOne({ _id: member.userId, status: 'active' }).lean();
        if (!user || member.status === 'disabled')
          throw new AppError(
            409,
            'OWNER_UNAVAILABLE',
            'An owner must have an active account and business membership',
          );
      }
      const removesOwner =
        (member.role === 'owner' || String(member.userId) === String(business.ownerUserId)) &&
        (change.remove || change.role === 'member' || change.status === 'disabled');
      if (removesOwner) {
        const [replacement] = await BusinessMembership.aggregate<{ userId: Types.ObjectId }>([
          {
            $match: {
              businessId: business._id,
              _id: { $ne: member._id },
              role: 'owner',
              status: { $ne: 'disabled' },
            },
          },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'account',
              pipeline: [{ $match: { status: 'active' } }, { $project: { _id: 1 } }],
            },
          },
          { $match: { 'account.0': { $exists: true } } },
          { $limit: 1 },
          { $project: { userId: 1 } },
        ]);
        if (!replacement)
          throw new AppError(
            409,
            'OWNER_PROTECTED',
            'Assign another active owner before removing, disabling or demoting the last owner',
          );
        // Move the primary pointer before removing its old owner; there is never a zero-owner window.
        if (String(business.ownerUserId) === String(member.userId))
          await Business.updateOne({ _id: businessId }, { ownerUserId: replacement.userId });
      }
      if (change.remove) await BusinessMembership.deleteOne({ _id: memberId, businessId });
      else
        await BusinessMembership.updateOne(
          { _id: memberId, businessId },
          {
            $set: {
              ...(change.role ? { role: change.role } : {}),
              ...(change.status ? { status: change.status } : {}),
            },
          },
          { runValidators: true },
        );
      return { success: true };
    },
  );
}
export async function businessState(
  actorId: string,
  businessId: string,
  state: 'active' | 'suspended' | 'archived',
) {
  return mutate(
    {
      actorId,
      businessId,
      targetId: businessId,
      scope: `business:${businessId}`,
      entity: 'businesses',
      action: `BUSINESS_${state.toUpperCase()}`,
      after: { adminState: state },
    },
    async (record) => {
      const business = await Business.findById(businessId).lean();
      if (!business) throw notFound('Business not found');
      const status =
        state === 'active' && business.status === 'disabled'
          ? business.onboarding?.completedAt
            ? 'active'
            : 'onboarding'
          : business.status;
      await record(
        { adminState: business.adminState ?? 'active', status: business.status },
        { adminState: state, status },
      );
      await Business.updateOne(
        { _id: businessId },
        { adminState: state, status },
        { runValidators: true },
      );
      return { success: true };
    },
  );
}

export async function instantRewardAccess(actorId: string, targetId: string, enabled: boolean) {
  return mutate(
    {
      actorId,
      targetId,
      scope: 'platform-users',
      entity: 'users',
      action: 'INSTANT_REWARD_ACCESS_CHANGED',
      after: { enabled },
    },
    async (record) => {
      if (actorId === targetId)
        throw new AppError(
          409,
          'SELF_PROTECTED',
          'You cannot change your own administrator access',
        );
      const user = await User.findById(targetId).lean();
      if (!user) throw notFound('User not found');
      if (user.status !== 'active')
        throw new AppError(
          409,
          'ACCOUNT_UNAVAILABLE',
          'Activate this account before changing its permissions',
        );
      await record({ permissions: user.permissions ?? [] });
      await User.updateOne(
        { _id: targetId },
        {
          ...(enabled
            ? { $addToSet: { permissions: 'instant_rewards:manage' } }
            : { $pull: { permissions: 'instant_rewards:manage' } }),
          $inc: { sessionVersion: 1 },
          $set: { sessionsRevokedAt: new Date() },
        },
      );
      await RefreshToken.updateMany(
        { userId: targetId },
        { revokedAt: new Date(), familyRevoked: true },
      );
      return { success: true };
    },
  );
}
