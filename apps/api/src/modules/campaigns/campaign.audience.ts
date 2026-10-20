import { Types, type QueryFilter } from 'mongoose';
import { Contact, type ContactDoc } from '../contacts/contact.model';
import { Response } from '../responses/response.model';
import { type CampaignInput, occasionDate } from './campaign.domain';
import { marketingAudienceStages } from './campaign.marketing';
export function audienceFilter(
  c: CampaignInput,
  businessId: string | Types.ObjectId,
  now: Date,
): QueryFilter<ContactDoc> {
  const a = c.audience;
  const filter: QueryFilter<ContactDoc> = { businessId: new Types.ObjectId(businessId) };
  if (a.type === 'selected') filter._id = { $in: a.contactIds.map((id) => new Types.ObjectId(id)) };
  if (a.tags.length) filter.tags = { $all: a.tags };
  if (a.segment) filter.segment = a.segment;
  if (a.loyaltyLevel) filter.loyaltyLevel = a.loyaltyLevel;
  if (a.type === 'inactive' || c.trigger.type === 'inactive')
    filter.lastResponseAt = { $lte: new Date(+now - a.inactiveDays * 86400000) };
  if (a.type === 'new' || c.trigger.type === 'welcome')
    filter.createdAt = { $gte: new Date(+now - a.newDays * 86400000) };
  if (a.type === 'birthday' || c.trigger.type === 'birthday')
    filter.birthday = occasionDate(c, now).monthDay;
  if (c.trigger.type === 'anniversary') filter.anniversary = occasionDate(c, now).monthDay;
  return filter;
}
export async function interactionEligible(
  c: CampaignInput,
  businessId: Types.ObjectId,
  contactId: Types.ObjectId,
) {
  return (
    !c.audience.minInteractions ||
    (await Response.countDocuments({ businessId, contactId })) >= c.audience.minInteractions
  );
}
export async function estimateAudience(
  c: CampaignInput,
  businessId: string | Types.ObjectId,
  now = new Date(),
) {
  // Mongo aggregation keeps interaction filters tenant-scoped without an unbounded ID array.
  const rows = await Contact.aggregate<{ count: number }>([
    { $match: audienceFilter(c, businessId, now) },
    ...marketingAudienceStages(),
    ...(c.audience.minInteractions
      ? [
          {
            $lookup: {
              from: 'responses',
              let: { cid: '$_id', bid: '$businessId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [{ $eq: ['$contactId', '$$cid'] }, { $eq: ['$businessId', '$$bid'] }],
                    },
                  },
                },
                { $limit: c.audience.minInteractions },
                { $count: 'n' },
              ],
              as: 'interactions',
            },
          },
          { $match: { 'interactions.0.n': { $gte: c.audience.minInteractions } } },
        ]
      : []),
    { $count: 'count' },
  ]);
  return rows[0]?.count ?? 0;
}
