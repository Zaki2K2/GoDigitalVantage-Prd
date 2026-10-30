import { z } from 'zod';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors';
import { Reward } from '../rewards/reward.model';
import { Business } from '../businesses/business.model';
import { BusinessMembership } from '../businesses/membership.model';
import { User } from '../auth/user.model';
import { Contact } from '../contacts/contact.model';
import { sendResendEmail, type EmailMessage } from '../email/email.service';
import { identityHash, issueCampaignReward, signToken } from '../rewards/reward.service';
import { marketingAllowed, unsubscribeUrl, applyMarketingReceipt } from './campaign.marketing';
import { EmailDeliveryEvent } from '../email/email.model';
import { campaignIndexesReady } from './campaign.migration';
import { Campaign, CampaignExecution, CampaignRecipient } from './campaign.model';
import { executionWindow, occasionDate } from './campaign.domain';
import { audienceFilter, interactionEligible } from './campaign.audience';
import { campaignAudit, getCampaign, ownerApproved, withCampaignLock } from './campaign.service';

export interface CampaignDeliveryProvider {
  send(message: EmailMessage): Promise<{ id: string }>;
}
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export async function executeCampaign(
  id: string,
  provider: CampaignDeliveryProvider = { send: sendResendEmail },
  now = new Date(),
) {
  const deadline = Date.now() + 40000;
  if (env.NODE_ENV === 'production' && !(await campaignIndexesReady()))
    throw new AppError(
      503,
      'CAMPAIGN_INDEXES_MISSING',
      'Run the approved campaign index migration before execution',
    );
  const tenant = (await getCampaign(id)).businessId;
  return withCampaignLock(`offers:${tenant}`, () =>
    withCampaignLock(id, async () => {
      const c = await getCampaign(id);
      await Campaign.updateOne({ _id: c._id }, { $set: { lastAttemptAt: now } });
      if (!['active', 'scheduled'].includes(c.status)) return { processed: 0 };
      if (now >= c.endDate) {
        await campaignAudit(
          String(c.createdBy),
          c.businessId,
          c._id,
          'campaign_completed',
          async () => {
            await Campaign.updateOne({ _id: c._id }, { $set: { status: 'completed' } });
          },
          true,
        );
        return { processed: 0 };
      }
      const business = await Business.findOne({
        _id: c.businessId,
        status: 'active',
        adminState: { $nin: ['suspended', 'archived'] },
      }).lean();
      const actor = await User.findOne({ _id: c.createdBy, status: 'active' }).lean();
      if (!business || !actor) return { processed: 0 };
      // Legacy platform campaigns have no approval record and therefore never send.
      if (!ownerApproved(c)) return { processed: 0 };
      if (
        c.ownerType === 'platform'
          ? actor.platformRole !== 'SUPER_ADMIN'
          : !(await BusinessMembership.exists({
              businessId: c.businessId,
              userId: c.createdBy,
              role: 'owner',
              status: { $ne: 'disabled' },
            }))
      )
        return { processed: 0 };
      const window = executionWindow(c, now);
      if (!window) return { processed: 0 };
      // Finish an interrupted batch before beginning another window. Old offer/message snapshots stay stable.
      let execution = await CampaignExecution.findOne({
        campaignId: c._id,
        status: 'running',
      }).sort({
        at: 1,
      });
      if (!execution)
        execution = await CampaignExecution.findOneAndUpdate(
          { campaignId: c._id, window },
          { $setOnInsert: { businessId: c.businessId, at: now } },
          { upsert: true, returnDocument: 'after' },
        );
      if (!execution || execution.status === 'completed') return { processed: 0 };
      const e = execution;
      let processed = 0;
      await campaignAudit(
        String(c.createdBy),
        c.businessId,
        c._id,
        'campaign_executed',
        async () => {
          await Campaign.updateOne(
            { _id: c._id, status: 'scheduled' },
            { $set: { status: 'active' } },
          );
          const retry = await CampaignRecipient.find({
            executionId: e._id,
            status: { $in: ['pending', 'failed'] },
            attempts: { $lt: 3 },
            $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
          })
            .sort({ _id: 1 })
            .limit(3);
          const stillApproved = async () =>
            c.ownerType !== 'platform' ||
            Boolean(
              await Campaign.exists({
                _id: c._id,
                status: { $in: ['active', 'scheduled'] },
                'ownerApproval.status': 'approved',
              }),
            );
          const deliver = async (r: (typeof retry)[number]) => {
            if (Date.now() > deadline - 10000) return;
            // Owner revocation takes effect before the next recipient; the row stays pending.
            if (!(await stillApproved())) return;
            if (+now - +r.startedAt > 19 * 3600000) {
              r.status = 'reconciliation';
              r.error = 'Provider retry window elapsed';
              await r.save();
              return;
            }
            const contact = await Contact.findOne({
              $and: [audienceFilter(c, c.businessId, e.at), { _id: r.contactId }],
            }).lean();
            if (!contact || !z.email().safeParse(contact.emailLowercase).success) {
              r.status = 'skipped';
              r.error = 'Recipient missing or invalid email';
              await r.save();
              return;
            }
            if (!(await marketingAllowed(contact))) {
              r.status = 'skipped';
              r.errorCode = 'MARKETING_SUPPRESSED';
              r.error = 'Marketing consent missing, withdrawn or suppressed';
              await r.save();
              return;
            }
            if (r.email && r.email !== contact.emailLowercase) {
              r.status = 'skipped';
              r.error = 'Recipient address changed';
              await r.save();
              return;
            }
            if (
              r.rewardId &&
              !(await Reward.exists({
                _id: r.rewardId,
                businessId: c.businessId,
                status: 'issued',
                expiresAt: { $gt: now },
              }))
            ) {
              r.status = 'skipped';
              r.error = 'Reward unavailable or expired';
              await r.save();
              return;
            }
            if (!r.text) {
              const conflicts = await Reward.find({
                businessId: c.businessId,
                campaignRecipientId: { $ne: r._id },
                identityHash: identityHash(c.businessId, contact, { ip: '', userAgent: '' }),
                status: { $in: ['issued', 'pending_approval'] },
                $or: [{ expiresAt: { $gt: now } }, { status: 'pending_approval' }],
              })
                .select('campaignId')
                .lean();
              let conflict = conflicts.length > 0;
              if (
                conflict &&
                c.offerPolicy === 'parallel' &&
                conflicts.every((r) => r.campaignId)
              ) {
                const allowed = await Campaign.countDocuments({
                  _id: { $in: conflicts.map((r) => new Types.ObjectId(String(r.campaignId))) },
                  businessId: c.businessId,
                  offerPolicy: 'parallel',
                });
                conflict = allowed !== new Set(conflicts.map((r) => String(r.campaignId))).size;
              }
              if (conflict) {
                r.status = 'skipped';
                r.errorCode = 'OFFER_CONFLICT';
                r.error = 'Customer already has an active offer';
                await r.save();
                return;
              }
              const reward = await issueCampaignReward(
                c._id,
                r._id,
                contact,
                c.name,
                c.offer,
                r.startedAt,
              );
              if (reward.status !== 'issued' || !reward.expiresAt || reward.expiresAt <= now) {
                r.status = 'skipped';
                r.error = 'Reward unavailable or expired';
                await r.save();
                return;
              }
              r.rewardId = reward._id;
              r.email = contact.emailLowercase;
              r.subject = c.name;
              r.unsubscribeUrl = unsubscribeUrl(contact);
              r.text = `${c.name}\n\n${c.description}\n\n${env.PUBLIC_APP_BASE_URL.replace(/\/+$/, '')}/reward/${signToken(reward._id)}\n\n${c.offer.terms}\n\nUnsubscribe from promotional emails: ${r.unsubscribeUrl}`;
              await r.save();
            }
            r.attempts++;
            await r.save();
            // Recheck immediately before every attempt, including a previously composed retry.
            const live = await Contact.findOne({
              _id: contact._id,
              businessId: c.businessId,
            }).lean();
            const liveBusiness = await Business.exists({
              _id: c.businessId,
              status: 'active',
              adminState: { $nin: ['suspended', 'archived'] },
            });
            if (
              !live ||
              live.emailLowercase !== r.email ||
              !liveBusiness ||
              !(await marketingAllowed(live))
            ) {
              r.status = 'skipped';
              r.errorCode = 'MARKETING_SUPPRESSED';
              r.error = 'Recipient or business is suppressed';
              await r.save();
              return;
            }
            if (!(await stillApproved())) return;
            if (!r.unsubscribeUrl) {
              r.status = 'reconciliation';
              r.error = 'Legacy promotional payload lacks unsubscribe link';
              await r.save();
              return;
            }
            processed++;
            try {
              const result = await provider.send({
                to: r.email!,
                subject: r.subject!,
                text: r.text!,
                html: `<p>${escapeHtml(r.text!).replace(/\n/g, '<br>')}</p>`,
                idempotencyKey: `campaign:${r._id}`,
                operationStartedAt: r.startedAt,
                unsubscribeUrl: r.unsubscribeUrl,
              });
              r.providerMessageId = result.id;
              r.status = 'accepted';
              r.error = null;
              r.errorCode = null;
              r.nextAttemptAt = null;
            } catch (error) {
              const uncertain =
                !(error instanceof AppError) ||
                [
                  'EMAIL_SEND_UNCERTAIN',
                  'EMAIL_IDEMPOTENCY_CONFLICT',
                  'EMAIL_RECONCILIATION_REQUIRED',
                ].includes(error.code);
              r.status = uncertain && r.attempts >= 3 ? 'reconciliation' : 'failed';
              r.error = error instanceof Error ? error.message.slice(0, 300) : 'Delivery failed';
              r.errorCode = error instanceof AppError ? error.code : 'EMAIL_SEND_UNCERTAIN';
              r.nextAttemptAt =
                r.status === 'failed' && r.attempts < 3
                  ? new Date(+now + 60000 * 2 ** (r.attempts - 1))
                  : null;
              await Campaign.updateOne({ _id: c._id }, { $set: { lastError: r.errorCode } });
            }
            await r.save();
            if (r.providerMessageId) {
              const events = await EmailDeliveryEvent.find({
                providerMessageId: r.providerMessageId,
                type: { $in: ['email.bounced', 'email.complained', 'email.suppressed'] },
              })
                .select('type')
                .lean();
              for (const event of events)
                await applyMarketingReceipt(r.providerMessageId, event.type);
            }
          };
          for (const r of retry) {
            if (Date.now() > deadline - 10000) break;
            await deliver(r);
          }
          const contacts = await Contact.find({
            $and: [
              audienceFilter(c, c.businessId, e.at),
              ...(e.cursor ? [{ _id: { $gt: e.cursor } }] : []),
            ],
          })
            .sort({ _id: 1 })
            .limit(30)
            .lean();
          let visited = 0;
          for (const contact of contacts) {
            if (processed >= 3 || Date.now() > deadline - 10000) break;
            visited++;
            if (await interactionEligible(c, c.businessId, contact._id)) {
              const annual = c.trigger.type === 'birthday' || c.trigger.type === 'anniversary';
              const key = `${contact._id}:${annual ? occasionDate(c, e.at).year : ['welcome', 'inactive'].includes(c.trigger.type) ? 'lifetime' : e.window}`;
              if (
                !(await CampaignRecipient.exists({ campaignId: c._id, dedupeKey: key })) &&
                c.allocated < c.usageLimit &&
                (await CampaignRecipient.countDocuments({
                  campaignId: c._id,
                  contactId: contact._id,
                  ...(annual ? { dedupeKey: key } : {}),
                })) < c.perCustomerLimit
              ) {
                // Reserve before creating recipient. A crash can waste capacity but cannot exceed the cap.
                await Campaign.updateOne({ _id: c._id }, { $inc: { allocated: 1 } });
                c.allocated++;
                const r = await CampaignRecipient.create({
                  campaignId: c._id,
                  businessId: c.businessId,
                  executionId: e._id,
                  contactId: contact._id,
                  window: e.window,
                  dedupeKey: key,
                  startedAt: now,
                });
                e.targeted++;
                await deliver(r);
              }
            }
            e.cursor = contact._id;
            await e.save();
          }
          if (
            visited === contacts.length &&
            contacts.length < 30 &&
            !(await CampaignRecipient.exists({
              executionId: e._id,
              status: { $in: ['pending', 'failed'] },
              attempts: { $lt: 3 },
            }))
          ) {
            e.status = 'completed';
            await e.save();
            if (c.trigger.type === 'once')
              await Campaign.updateOne({ _id: c._id }, { $set: { status: 'completed' } });
          }
        },
        true,
      );
      await Campaign.updateOne({ _id: c._id }, { $set: { lastSuccessAt: now } });
      return { processed };
    }),
  );
}

export async function runCampaignBatch() {
  // Round robin via updatedAt. Each request handles at most three provider calls.
  const campaigns = await Campaign.find({
    status: { $in: ['active', 'scheduled'] },
    startDate: { $lte: new Date() },
  })
    .sort({ lastCheckedAt: 1, priority: -1, _id: 1 })
    .limit(1)
    .lean();
  if (!campaigns.length) return { processed: 0 };
  const c = campaigns[0]!;
  const at = new Date();
  await Campaign.updateOne({ _id: c._id }, { $set: { lastCheckedAt: at } });
  try {
    return await executeCampaign(String(c._id));
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'CAMPAIGN_EXECUTION_FAILED';
    await Campaign.updateOne({ _id: c._id }, { $set: { lastError: code, lastAttemptAt: at } });
    if (code === 'CAMPAIGN_BUSY') return { processed: 0, busy: true };
    throw error;
  }
}
