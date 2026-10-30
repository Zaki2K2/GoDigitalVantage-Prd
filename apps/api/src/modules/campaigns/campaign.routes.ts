import { Router } from 'express';
import { env } from '../../config/env';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { assertBusinessPermission } from '../../middleware/business-permissions';
import { findMembership } from '../businesses/business.service';
import { Business } from '../businesses/business.model';
import { requireSuperAdmin } from '../admin/admin.auth';
import { authorizeBusinessWrite } from '../admin/support-access';
import { reviewPlatformCampaigns } from './campaign.legacy-audit';
import { Contact } from '../contacts/contact.model';
import { EmailDeliveryEvent } from '../email/email.model';
import { AppError, forbidden, notFound } from '../../shared/errors';
import { paginationQuery, pageMeta } from '../../shared/pagination';
import { Campaign, CampaignExecution, CampaignRecipient, CampaignTemplate } from './campaign.model';
import {
  CAMPAIGN_ACTIONS,
  campaignAudit,
  createCampaign,
  getCampaign,
  transitionCampaign,
  updateCampaign,
} from './campaign.service';
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_TEMPLATES,
  campaignInput,
  campaignConfig,
  idSchema,
  profileSchema,
} from './campaign.domain';
import { estimateAudience } from './campaign.audience';
import { MarketingConsent, MarketingSuppression, suppressMarketing } from './campaign.marketing';
import { CampaignLock, CampaignSchedulerState } from './campaign.model';
import { campaignIndexesReady } from './campaign.migration';

export function createCampaignRouter() {
  const router = Router();
  router.patch(
    '/businesses/:businessId/contacts/:contactId/marketing-email',
    requireAuth,
    requireBusinessAccess(findMembership),
    async (req, res) => {
      assertBusinessPermission(req.tenant!.role, 'contacts:manage');
      const input = z
        .object({
          state: z.enum(['granted', 'revoked']),
          evidence: z.string().trim().min(10).max(1000),
        })
        .strict()
        .parse(req.body);
      const contact = await Contact.findOne({
        _id: idSchema.parse(req.params['contactId']),
        businessId: req.tenant!.businessId,
      }).lean();
      if (
        !contact ||
        !contact.emailLowercase ||
        !z.email().safeParse(contact.emailLowercase).success
      )
        throw notFound('Contact with a valid email required');
      if (
        input.state === 'granted' &&
        (await MarketingSuppression.exists({
          businessId: contact.businessId,
          email: contact.emailLowercase,
        }))
      )
        throw new AppError(
          409,
          'MARKETING_SUPPRESSED',
          'Unsubscribe or provider suppression cannot be overridden by staff',
        );
      await campaignAudit(
        req.auth!.userId,
        contact.businessId,
        contact._id,
        'marketing_email_consent_updated',
        async () => {
          if (input.state === 'revoked')
            await suppressMarketing(
              contact.businessId,
              contact.emailLowercase!,
              'staff_revocation',
            );
          await MarketingConsent.updateOne(
            { businessId: contact.businessId, contactId: contact._id },
            {
              $set: {
                ...input,
                email: contact.emailLowercase,
                actorUserId: req.auth!.userId,
                at: new Date(),
              },
            },
            { upsert: true },
          );
        },
        false,
        { ...input, email: contact.emailLowercase },
      );
      res.json({ data: { state: input.state } });
    },
  );
  router.get('/admin/campaigns/owner-review', requireAuth, requireSuperAdmin, async (_req, res) => {
    const rows = await reviewPlatformCampaigns();
    res.set('Cache-Control', 'no-store').json({
      data: rows.filter((r) => r.needsOwnerReview),
      total: rows.length,
    });
  });
  router.get('/admin/campaigns/monitoring', requireAuth, requireSuperAdmin, async (req, res) => {
    const q = z
      .object({
        ...paginationQuery,
        status: z.enum(['failed', 'reconciliation', 'pending']).optional(),
      })
      .parse(req.query);
    const statuses: Array<'failed' | 'reconciliation' | 'pending'> = q.status
      ? [q.status]
      : ['failed', 'reconciliation', 'pending'];
    const filter = { status: { $in: statuses } };
    const [recipients, total, locks, recentChecks, counts, scheduler, indexesReady] =
      await Promise.all([
        CampaignRecipient.find(filter)
          .select(
            'status attempts errorCode window startedAt nextAttemptAt campaignId businessId createdAt updatedAt',
          )
          .sort({ updatedAt: -1, _id: -1 })
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize)
          .lean(),
        CampaignRecipient.countDocuments(filter),
        CampaignLock.find().sort({ at: 1 }).limit(50).select('-token').lean(),
        Campaign.find({ status: { $in: ['active', 'scheduled'] } })
          .sort({ lastCheckedAt: 1, _id: 1 })
          .limit(20)
          .select('name businessId status lastCheckedAt lastAttemptAt lastSuccessAt lastError')
          .lean(),
        CampaignRecipient.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        CampaignSchedulerState.findById('scheduler').lean(),
        campaignIndexesReady(),
      ]);
    res.set('Cache-Control', 'no-store').json({
      data: {
        recipients,
        locks,
        recentChecks,
        counts,
        scheduler,
        configuration: {
          indexesReady,
          emailEnabled: env.EMAIL_ENABLED,
          unsubscribeConfigured: Boolean(
            env.MARKETING_UNSUBSCRIBE_SECRET || env.NODE_ENV !== 'production',
          ),
          schedulerConfigured: (process.env['CRON_SECRET']?.length ?? 0) >= 32,
        },
        serverTime: new Date(),
      },
      pagination: pageMeta(q.page, q.pageSize, total),
    });
  });
  router.patch(
    '/businesses/:businessId/contacts/:contactId/campaign-profile',
    requireAuth,
    requireBusinessAccess(findMembership),
    async (req, res) => {
      assertBusinessPermission(req.tenant!.role, 'contacts:manage');
      const contactId = idSchema.parse(req.params['contactId']),
        input = profileSchema.parse(req.body);
      const c = await Contact.findOne({ _id: contactId, businessId: req.tenant!.businessId });
      if (!c) throw notFound('Contact not found');
      await campaignAudit(
        req.auth!.userId,
        c.businessId,
        c._id,
        'contact_campaign_profile_updated',
        async () => {
          await Contact.updateOne({ _id: c._id, businessId: c.businessId }, { $set: input });
        },
      );
      res.json({ data: input });
    },
  );
  for (const platform of [false, true]) {
    const root = platform ? '/admin/campaigns' : '/businesses/:businessId/campaigns';
    const access = platform
      ? [requireAuth, requireSuperAdmin]
      : [requireAuth, requireBusinessAccess(findMembership)];
    const scope = (req: import('express').Request) =>
      platform ? undefined : req.tenant!.businessId;
    const writable = (req: import('express').Request, c?: { ownerType: string }) => {
      if (!platform) {
        assertBusinessPermission(req.tenant!.role, 'campaigns:manage');
        if (c?.ownerType === 'platform')
          throw forbidden('Platform campaigns are managed by Super Admin');
      }
    };
    if (!platform)
      router.post(`${root}/:campaignId/owner-approval`, ...access, async (req, res) => {
        // Only the owner decides whether platform staff may message this business's customers.
        if (req.tenant!.role !== 'owner')
          throw forbidden('Only business owners can approve platform campaigns');
        const input = z
          .object({ decision: z.enum(['approve', 'reject']), confirm: z.literal(true) })
          .strict()
          .parse(req.body);
        const c = await getCampaign(String(req.params['campaignId']), scope(req));
        if (c.ownerType !== 'platform') throw notFound('Campaign not found');
        if (!['draft', 'scheduled', 'active', 'paused'].includes(c.status))
          throw new AppError(409, 'INVALID_STATE', 'This campaign is closed');
        const status = input.decision === 'approve' ? 'approved' : 'rejected';
        await campaignAudit(
          req.auth!.userId,
          c.businessId,
          c._id,
          `campaign_owner_${status}`,
          async () => {
            await Campaign.updateOne(
              { _id: c._id, businessId: c.businessId },
              {
                $set: {
                  ownerApproval: { status, decidedBy: req.auth!.userId, decidedAt: new Date() },
                },
              },
            );
          },
        );
        res.json({ data: { ownerApproval: status } });
      });
    // Platform operators may only change a business's campaigns under an owner-approved write grant.
    const gate = async (req: import('express').Request, businessId: unknown) => {
      if (platform) await authorizeBusinessWrite(req, String(businessId), 'campaigns');
    };
    router.get(`${root}/templates`, ...access, async (_req, res) => {
      res.json({
        data: CAMPAIGN_TEMPLATES,
        global: await CampaignTemplate.find().sort({ createdAt: -1 }).limit(100).lean(),
      });
    });
    if (platform) {
      router.post(`${root}/templates`, ...access, async (req, res) => {
        const input = campaignInput.parse(req.body);
        if (input.audience.contactIds.length || input.audience.type === 'selected')
          throw new AppError(
            422,
            'TEMPLATE_AUDIENCE_INVALID',
            'Global templates cannot contain tenant contact IDs',
          );
        const t = new CampaignTemplate({ name: input.name, input, createdBy: req.auth!.userId });
        await campaignAudit(
          req.auth!.userId,
          null,
          t._id,
          'campaign_template_created',
          async () => {
            await t.save();
          },
        );
        res.status(201).json({ data: t });
      });
      router.post(`${root}/templates/:templateId/assign`, ...access, async (req, res) => {
        const input = z
          .object({
            businessIds: z.array(idSchema).min(1).max(50).optional(),
            all: z.literal(true).optional(),
            cursor: idSchema.optional(),
          })
          .strict()
          .refine(
            (v) => Boolean(v.all) !== Boolean(v.businessIds),
            'Choose all or selected businesses',
          )
          .parse(req.body);
        const t = await CampaignTemplate.findById(idSchema.parse(req.params['templateId'])).lean();
        if (!t) throw notFound('Template not found');
        const targets = input.all
          ? await Business.find({
              status: 'active',
              adminState: { $nin: ['suspended', 'archived'] },
              ...(input.cursor ? { _id: { $gt: input.cursor } } : {}),
            })
              .sort({ _id: 1 })
              .limit(10)
              .select('_id')
              .lean()
          : null;
        const ids = targets ? targets.map((b) => String(b._id)) : input.businessIds!;
        const created = [];
        for (const businessId of [...new Set(ids)]) {
          // Bulk assignment skips businesses without a grant; explicit selections must hold one.
          if (input.all) {
            const granted = await authorizeBusinessWrite(req, businessId, 'campaigns').then(
              () => true,
              () => false,
            );
            if (!granted) continue;
          } else await gate(req, businessId);
          if (
            !(await Business.exists({
              _id: businessId,
              status: 'active',
              adminState: { $nin: ['suspended', 'archived'] },
            }))
          )
            throw notFound('Active business not found');
          created.push(
            await createCampaign(
              campaignConfig(t.input),
              businessId,
              req.auth!.userId,
              true,
              `template:${t._id}:business:${businessId}`,
            ),
          );
        }
        res.status(201).json({
          data: created,
          nextCursor: targets?.length === 10 ? String(targets[targets.length - 1]!._id) : null,
        });
      });
    }
    router.get(root, ...access, async (req, res) => {
      const q = z
        .object({
          ...paginationQuery,
          status: z.enum(CAMPAIGN_STATUSES).optional(),
          businessId: idSchema.optional(),
        })
        .parse(req.query);
      const businessId = scope(req) ?? q.businessId;
      const filter = {
        ...(businessId ? { businessId } : {}),
        ...(q.status ? { status: q.status } : {}),
      };
      const [data, total] = await Promise.all([
        Campaign.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize)
          .lean(),
        Campaign.countDocuments(filter),
      ]);
      const metrics = await CampaignRecipient.aggregate<{
        _id: Types.ObjectId;
        sent: number;
        redeemed: number;
        issued: number;
        targeted: number;
      }>([
        {
          $match: {
            campaignId: { $in: data.map((c) => c._id) },
            ...(businessId ? { businessId: new Types.ObjectId(businessId) } : {}),
          },
        },
        { $lookup: { from: 'rewards', localField: 'rewardId', foreignField: '_id', as: 'reward' } },
        {
          $group: {
            _id: '$campaignId',
            targeted: { $sum: 1 },
            issued: { $sum: { $cond: [{ $gt: [{ $size: '$reward' }, 0] }, 1, 0] } },
            sent: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
            redeemed: {
              $sum: {
                $cond: [{ $eq: [{ $arrayElemAt: ['$reward.status', 0] }, 'redeemed'] }, 1, 0],
              },
            },
          },
        },
      ]);
      res.set('Cache-Control', 'no-store').json({
        data: data.map((c) => ({
          ...c,
          metrics: metrics.find((m) => String(m._id) === String(c._id)) ?? {
            sent: 0,
            redeemed: 0,
            targeted: 0,
            issued: 0,
          },
        })),
        pagination: pageMeta(q.page, q.pageSize, total),
      });
    });
    router.post(root, ...access, async (req, res) => {
      writable(req);
      const raw = z
        .object({ input: campaignInput, businessId: idSchema.optional() })
        .strict()
        .parse(req.body);
      const businessId = scope(req) ?? raw.businessId;
      if (!businessId) throw new AppError(422, 'BUSINESS_REQUIRED', 'Select a target business');
      await gate(req, businessId);
      if (
        !(await Business.exists({
          _id: businessId,
          status: 'active',
          adminState: { $nin: ['suspended', 'archived'] },
        }))
      )
        throw notFound('Active business not found');
      res
        .status(201)
        .json({ data: await createCampaign(raw.input, businessId, req.auth!.userId, platform) });
    });
    router.get(`${root}/:campaignId`, ...access, async (req, res) => {
      const found = await getCampaign(String(req.params['campaignId']), scope(req));
      // Platform view: no tenant contact ids, no per-recipient identifiers or message bodies.
      const c = platform
        ? {
            ...found,
            audience: { ...found.audience, contactIds: [] as typeof found.audience.contactIds },
          }
        : found;
      const q = z.object({ ...paginationQuery }).parse(req.query);
      const recipientFilter = { campaignId: c._id, businessId: c.businessId };
      const [
        estimatedRecipients,
        recipients,
        executions,
        total,
        counts,
        rewardCounts,
        deliveryCounts,
      ] = await Promise.all([
        estimateAudience(c, c.businessId),
        CampaignRecipient.find(recipientFilter)
          .select('-text -email -subject -unsubscribeUrl')
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize)
          .lean(),
        CampaignExecution.find(recipientFilter).sort({ at: -1 }).limit(30).lean(),
        CampaignRecipient.countDocuments(recipientFilter),
        CampaignRecipient.aggregate<{ _id: string; n: number }>([
          { $match: recipientFilter },
          { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
        CampaignRecipient.aggregate<{ _id: string; n: number }>([
          { $match: recipientFilter },
          {
            $lookup: { from: 'rewards', localField: 'rewardId', foreignField: '_id', as: 'reward' },
          },
          { $unwind: '$reward' },
          { $match: { 'reward.businessId': c.businessId } },
          { $group: { _id: '$reward.status', n: { $sum: 1 } } },
        ]),
        CampaignRecipient.aggregate<{ _id: string; n: number }>([
          { $match: { ...recipientFilter, providerMessageId: { $type: 'string' } } },
          {
            $lookup: {
              from: 'email_delivery_events',
              localField: 'providerMessageId',
              foreignField: 'providerMessageId',
              as: 'events',
            },
          },
          { $unwind: '$events' },
          {
            $group: {
              _id: {
                recipient: '$_id',
                type: {
                  $cond: [
                    { $eq: ['$events.type', 'email.delivered'] },
                    'email.delivered',
                    'failure',
                  ],
                },
              },
            },
          },
          { $group: { _id: '$_id.type', n: { $sum: 1 } } },
        ]),
      ]);
      const count = (status: string) => counts.find((r) => r._id === status)?.n ?? 0;
      const receipts = await EmailDeliveryEvent.find({
        providerMessageId: {
          $in: recipients.flatMap((r) => (r.providerMessageId ? [r.providerMessageId] : [])),
        },
      })
        .select('providerMessageId type occurredAt')
        .sort({ occurredAt: -1 })
        .limit(200)
        .lean();
      const sent = count('accepted'),
        redeemed = rewardCounts.find((r) => r._id === 'redeemed')?.n ?? 0;
      res.set('Cache-Control', 'no-store').json({
        data: {
          campaign: c,
          estimatedRecipients,
          recipients: recipients.map((r) => ({
            ...(platform
              ? {
                  _id: r._id,
                  status: r.status,
                  attempts: r.attempts,
                  errorCode: r.errorCode,
                  startedAt: r.startedAt,
                  updatedAt: (r as { updatedAt?: Date }).updatedAt,
                }
              : r),
            deliveryEvents: receipts
              .filter((e) => e.providerMessageId === r.providerMessageId)
              .map((e) => ({ type: e.type, occurredAt: e.occurredAt })),
          })),
          executions,
          pagination: pageMeta(q.page, q.pageSize, total),
          metrics: {
            targeted: total,
            sent,
            failed: count('failed'),
            skipped: count('skipped'),
            reconciliation: count('reconciliation'),
            delivered: deliveryCounts.find((r) => r._id === 'email.delivered')?.n ?? 0,
            deliveryFailures: deliveryCounts
              .filter((r) => r._id !== 'email.delivered')
              .reduce((n, r) => n + r.n, 0),
            issued: rewardCounts.reduce((n, r) => n + r.n, 0),
            redeemed,
            redemptionRate: rewardCounts.reduce((n, r) => n + r.n, 0)
              ? (redeemed / rewardCounts.reduce((n, r) => n + r.n, 0)) * 100
              : null,
            conversionRate: total ? (redeemed / total) * 100 : null,
          },
        },
      });
    });
    router.patch(`${root}/:campaignId`, ...access, async (req, res) => {
      const c = await getCampaign(String(req.params['campaignId']), scope(req));
      writable(req, c);
      await gate(req, c.businessId);
      const body = z
        .object({ input: campaignInput, revision: z.number().int().min(0) })
        .strict()
        .parse(req.body);
      res.json({ data: await updateCampaign(c, body.input, req.auth!.userId, body.revision) });
    });
    router.post(`${root}/:campaignId/duplicate`, ...access, async (req, res) => {
      const c = await getCampaign(String(req.params['campaignId']), scope(req));
      writable(req, c);
      await gate(req, c.businessId);
      res.status(201).json({
        data: await createCampaign(
          { ...campaignConfig(c), name: `${c.name.slice(0, 110)} (copy)` },
          String(c.businessId),
          req.auth!.userId,
          platform,
        ),
      });
    });
    for (const action of CAMPAIGN_ACTIONS)
      router.post(`${root}/:campaignId/${action}`, ...access, async (req, res) => {
        const c = await getCampaign(String(req.params['campaignId']), scope(req));
        writable(req, c);
        await gate(req, c.businessId);
        const input = z
          .object({
            confirm: z.literal(true),
            revision: z.number().int().min(0),
            confirmedCount: z.number().int().min(0).optional(),
          })
          .strict()
          .parse(req.body);
        res.json({
          data: await transitionCampaign(
            c,
            action,
            req.auth!.userId,
            input.revision,
            input.confirmedCount,
          ),
        });
      });
  }
  return router;
}
