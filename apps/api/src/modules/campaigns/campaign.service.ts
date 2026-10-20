import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError, notFound } from '../../shared/errors';
import { User } from '../auth/user.model';
import { AdminAudit } from '../admin/admin.model';
import { Campaign, CampaignLock, type CampaignDoc } from './campaign.model';
import { type CampaignInput, idSchema } from './campaign.domain';
import { estimateAudience } from './campaign.audience';
import { Reward } from '../rewards/reward.model';

export async function withCampaignLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  try {
    await CampaignLock.create({ _id: id, token, at: new Date() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000)
      throw new AppError(
        409,
        'CAMPAIGN_BUSY',
        'Campaign operation in progress; interrupted operations require operator reconciliation',
      );
    throw e;
  }
  try {
    return await run();
  } finally {
    await CampaignLock.deleteOne({ _id: id, token });
  }
}
export async function campaignAudit(
  actorId: string,
  businessId: Types.ObjectId | null,
  targetId: Types.ObjectId,
  action: string,
  run: () => Promise<unknown>,
  system = false,
  details: Record<string, unknown> = {},
) {
  const actor = await User.findById(actorId).lean();
  const audit = await AdminAudit.create({
    actorUserId: actorId,
    actorName: system ? 'Campaign scheduler' : (actor?.fullName ?? 'Deleted user'),
    actorEmail: actor?.emailLowercase ?? 'system',
    actorRole: system ? 'SYSTEM' : (actor?.platformRole ?? 'USER'),
    businessId,
    entity: 'campaign',
    targetId,
    action,
    outcome: 'pending',
    after: details,
  });
  try {
    const result = await run();
    await AdminAudit.updateOne({ _id: audit._id }, { $set: { outcome: 'completed' } });
    return result;
  } catch (e) {
    await AdminAudit.updateOne({ _id: audit._id }, { $set: { outcome: 'failed' } });
    throw e;
  }
}
export async function getCampaign(id: string, businessId?: string) {
  idSchema.parse(id);
  const c = await Campaign.findOne({ _id: id, ...(businessId ? { businessId } : {}) }).lean();
  if (!c) throw notFound('Campaign not found');
  return c;
}
export async function createCampaign(
  input: CampaignInput,
  businessId: string,
  actorId: string,
  platform = false,
  assignmentKey?: string,
) {
  if (assignmentKey) {
    const existing = await Campaign.findOne({ assignmentKey, businessId }).lean();
    if (existing) return existing;
  }
  const _id = new Types.ObjectId();
  await campaignAudit(
    actorId,
    new Types.ObjectId(businessId),
    _id,
    'campaign_created',
    async () => {
      await Campaign.create({
        ...input,
        _id,
        businessId,
        createdBy: actorId,
        ownerType: platform ? 'platform' : 'business',
        ...(assignmentKey ? { assignmentKey } : {}),
      });
    },
  );
  return getCampaign(String(_id), businessId);
}
export async function updateCampaign(
  c: CampaignDoc,
  input: CampaignInput,
  actorId: string,
  revision: number,
) {
  return withCampaignLock(String(c._id), async () => {
    await campaignAudit(actorId, c.businessId, c._id, 'campaign_updated', async () => {
      const updated = await Campaign.updateOne(
        { _id: c._id, businessId: c.businessId, status: 'draft', revision },
        { $set: input, $inc: { revision: 1 } },
      );
      if (!updated.modifiedCount)
        throw new AppError(409, 'REVISION_CONFLICT', 'Only the current draft can be edited');
    });
    return getCampaign(String(c._id), String(c.businessId));
  });
}
export const CAMPAIGN_ACTIONS = ['schedule', 'activate', 'pause', 'resume', 'cancel'] as const;
export async function transitionCampaign(
  c: CampaignDoc,
  action: (typeof CAMPAIGN_ACTIONS)[number],
  actorId: string,
  revision: number,
  confirmedCount?: number,
) {
  return withCampaignLock(String(c._id), async () => {
    const current = await getCampaign(String(c._id), String(c.businessId));
    if (current.revision !== revision)
      throw new AppError(409, 'REVISION_CONFLICT', 'Campaign has changed; review again');
    const from = {
      schedule: ['draft'],
      activate: ['draft'],
      pause: ['active', 'scheduled'],
      resume: ['paused'],
      cancel: ['draft', 'scheduled', 'active', 'paused'],
    }[action];
    if (!from.includes(current.status))
      throw new AppError(409, 'INVALID_STATE', 'Campaign action is unavailable');
    if (action === 'schedule' || action === 'activate' || action === 'resume') {
      if (current.endDate <= new Date())
        throw new AppError(422, 'CAMPAIGN_EXPIRED', 'Campaign has ended');
      const count = await estimateAudience(current, current.businessId);
      if (confirmedCount === undefined || confirmedCount !== count)
        throw new AppError(
          409,
          'AUDIENCE_CONFIRMATION_REQUIRED',
          'Review and confirm the current estimated audience',
          { estimatedRecipients: count },
        );
    }
    const status =
      action === 'cancel'
        ? 'cancelled'
        : action === 'pause'
          ? 'paused'
          : current.startDate > new Date()
            ? 'scheduled'
            : 'active';
    await campaignAudit(
      actorId,
      current.businessId,
      current._id,
      `campaign_${{ schedule: 'scheduled', activate: 'activated', pause: 'paused', resume: 'resumed', cancel: 'cancelled' }[action]}`,
      async () => {
        await Campaign.updateOne(
          { _id: current._id, revision },
          { $set: { status }, $inc: { revision: 1 } },
        );
        if (action === 'cancel')
          await Reward.updateMany(
            { businessId: current.businessId, campaignId: current._id, status: 'issued' },
            { $set: { status: 'cancelled', decisionNote: 'Campaign cancelled' } },
          );
      },
    );
    return getCampaign(String(c._id), String(c.businessId));
  });
}
