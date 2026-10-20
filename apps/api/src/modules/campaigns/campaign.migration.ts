import { Reward, RewardOrderClaim } from '../rewards/reward.model';
import { MarketingConsent, MarketingSuppression } from './campaign.marketing';
import { EmailDeliveryEvent } from '../email/email.model';
import { isDeepStrictEqual } from 'node:util';
export async function campaignIndexesReady() {
  try {
    for (const m of [
      Campaign,
      CampaignExecution,
      CampaignRecipient,
      MarketingConsent,
      MarketingSuppression,
      RewardOrderClaim,
      Reward,
      Contact,
      EmailDeliveryEvent,
    ]) {
      const actual = await m.collection.indexes();
      for (const [key, options] of m.schema.indexes().filter(([, options]) => options.unique)) {
        if (
          !actual.some(
            (i) =>
              i.unique &&
              isDeepStrictEqual(i.key, key) &&
              isDeepStrictEqual(i.partialFilterExpression, options.partialFilterExpression),
          )
        )
          return false;
      }
    }
    return (await CampaignLock.collection.indexes()).some((i) => i.name === '_id_');
  } catch (error) {
    if ((error as { code?: number }).code === 26) return false;
    throw error;
  }
}
import { Contact } from '../contacts/contact.model';
import {
  Campaign,
  CampaignExecution,
  CampaignRecipient,
  CampaignLock,
  CampaignTemplate,
} from './campaign.model';
/** Run with writers stopped. A guard preserves response uniqueness throughout index replacement. */
export async function migrateCampaignIndexes() {
  // This schema declares only _id; createIndexes alone cannot provision a missing lock collection.
  await CampaignLock.createCollection();
  const keys = { businessId: 1, responseId: 1 } as const;
  const guard = 'campaign_response_migration_guard';
  await Reward.collection.createIndex(keys, {
    name: guard,
    unique: true,
    partialFilterExpression: {
      businessId: { $type: 'objectId' },
      responseId: { $type: 'objectId' },
    },
  });
  const indexes = await Reward.collection.indexes();
  if (indexes.some((i) => i.name === 'businessId_1_responseId_1'))
    await Reward.collection.dropIndex('businessId_1_responseId_1');
  await Reward.collection.createIndex(keys, {
    name: 'business_response_unique',
    unique: true,
    partialFilterExpression: { responseId: { $type: 'objectId' } },
  });
  for (const m of [
    Reward,
    Contact,
    Campaign,
    CampaignExecution,
    CampaignRecipient,
    CampaignLock,
    CampaignTemplate,
    MarketingConsent,
    MarketingSuppression,
    RewardOrderClaim,
    EmailDeliveryEvent,
  ])
    await m.createIndexes();
  await Reward.collection.dropIndex(guard);
}
