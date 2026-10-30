import mongoose from 'mongoose';
import { User } from '../auth/user.model';
import { Business } from '../businesses/business.model';
import { Campaign, CampaignRecipient } from './campaign.model';
import { MarketingConsent, MarketingSuppression } from './campaign.marketing';

/**
 * Read-only review of platform-owned campaigns. The report holds identifiers and counts only:
 * no recipient emails, names, message bodies or contact ids.
 */
export interface PlatformCampaignReview {
  campaignId: string;
  businessId: string;
  status: string;
  ownerApproval: 'approved' | 'pending' | 'rejected' | 'missing';
  /** Delivery is blocked until the business owner approves (missing counts as unapproved). */
  deliveryBlocked: boolean;
  needsOwnerReview: boolean;
  reasons: string[];
  recipients: Record<string, number>;
  unsentRecipients: number;
  /** Stored recipients whose contact currently lacks marketing consent or is suppressed. */
  recipientsNowSuppressedOrUnconsented: number;
  hasHandPickedAudience: boolean;
  creatorActiveSuperAdmin: boolean;
  businessAvailable: boolean;
}

export async function reviewPlatformCampaigns(limit = 500): Promise<PlatformCampaignReview[]> {
  const campaigns = await Campaign.find({ ownerType: 'platform' })
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  const out: PlatformCampaignReview[] = [];
  for (const c of campaigns) {
    const [counts, unsuppressed, creator, business] = await Promise.all([
      CampaignRecipient.aggregate<{ _id: string; n: number }>([
        { $match: { campaignId: c._id, businessId: c.businessId } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      // Contacts still allowed to receive marketing; the difference is "now suppressed/unconsented".
      mongoose.connection
        .collection('campaign_recipients')
        .aggregate<{ n: number }>([
          { $match: { campaignId: c._id, businessId: c.businessId } },
          {
            $lookup: {
              from: MarketingConsent.collection.name,
              let: { cid: '$contactId', bid: '$businessId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$contactId', '$$cid'] },
                        { $eq: ['$businessId', '$$bid'] },
                        { $eq: ['$state', 'granted'] },
                      ],
                    },
                  },
                },
                { $limit: 1 },
              ],
              as: 'consent',
            },
          },
          {
            $lookup: {
              from: MarketingSuppression.collection.name,
              let: { email: '$email', bid: '$businessId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [{ $eq: ['$email', '$$email'] }, { $eq: ['$businessId', '$$bid'] }],
                    },
                  },
                },
                { $limit: 1 },
              ],
              as: 'suppression',
            },
          },
          {
            $match: {
              $or: [{ consent: { $size: 0 } }, { 'suppression.0': { $exists: true } }],
            },
          },
          { $count: 'n' },
        ])
        .toArray(),
      User.findOne({ _id: c.createdBy }, { platformRole: 1, status: 1 }).lean(),
      Business.findOne({ _id: c.businessId }, { status: 1, adminState: 1 }).lean(),
    ]);
    const recipients = Object.fromEntries(counts.map((r) => [r._id, r.n]));
    const unsent =
      (recipients['pending'] ?? 0) +
      (recipients['failed'] ?? 0) +
      (recipients['reconciliation'] ?? 0);
    const approval = c.ownerApproval?.status ?? 'missing';
    const hasHandPicked =
      c.audience.type === 'selected' || (c.audience.contactIds?.length ?? 0) > 0;
    const creatorOk = creator?.status === 'active' && creator.platformRole === 'SUPER_ADMIN';
    const live = ['draft', 'scheduled', 'active', 'paused'].includes(c.status);
    const reasons: string[] = [];
    if (approval !== 'approved') reasons.push('No current owner approval');
    if (hasHandPicked) reasons.push('Audience was hand-picked by platform staff');
    if (!creatorOk) reasons.push('Creating administrator is no longer an active Super Admin');
    const suppressed = unsuppressed[0]?.n ?? 0;
    if (suppressed) reasons.push('Stored recipients now lack consent or are suppressed');
    out.push({
      campaignId: String(c._id),
      businessId: String(c.businessId),
      status: c.status,
      ownerApproval: approval,
      deliveryBlocked: approval !== 'approved' || !creatorOk,
      needsOwnerReview: live && reasons.length > 0,
      reasons,
      recipients,
      unsentRecipients: unsent,
      recipientsNowSuppressedOrUnconsented: suppressed,
      hasHandPickedAudience: hasHandPicked,
      creatorActiveSuperAdmin: creatorOk,
      businessAvailable:
        !!business &&
        business.status !== 'disabled' &&
        (business.adminState ?? 'active') === 'active',
    });
  }
  return out;
}
