import * as rewardService from '../rewards/reward.service';
import { decisionSchema } from '../rewards/reward.schemas';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import QRCode from 'qrcode';
import { requireAuth } from '../../middleware/require-auth';
import { requireSuperAdmin } from './admin.auth';
import { idSchema, listSchema } from './admin.schemas';
import * as service from './admin.service';
import * as actions from './admin.actions';
import { Business } from '../businesses/business.model';
import { updateBusinessSchema } from '../businesses/business.schemas';
import { publish } from '../questionnaires/questionnaire.service';
import { Questionnaire, QuestionnaireVersion } from '../questionnaires/questionnaire.model';
import { publicUrlFor } from '../qr/qr.routes';
import { env } from '../../config/env';
import { escapeRegex, pageMeta } from '../../shared/pagination';

export function createAdminRouter() {
  const router = Router();
  router.use('/admin', requireAuth, requireSuperAdmin);
  const id = (value: unknown) => idSchema.parse(value);
  router.post('/admin/users/:id/instant-reward-access', async (req, res) => {
    const body = z
      .object({ enabled: z.boolean(), confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json({
      data: await actions.instantRewardAccess(req.auth!.userId, id(req.params['id']), body.enabled),
    });
  });
  router.get('/admin/dashboard', async (_req, res) => {
    const count = (collection: string, filter: Record<string, unknown> = {}) =>
      mongoose.connection.collection(collection).countDocuments(filter);
    const month = new Date();
    month.setUTCDate(1);
    month.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const entries = await Promise.all(
      [
        ['Businesses', count('businesses')],
        ['Suspended businesses', count('businesses', { adminState: 'suspended' })],
        [
          'Active businesses',
          count('businesses', {
            status: 'active',
            adminState: { $nin: ['suspended', 'archived'] },
          }),
        ],
        ['New businesses this month', count('businesses', { createdAt: { $gte: month } })],
        ['Onboarding complete', count('businesses', { 'onboarding.completedAt': { $ne: null } })],
        ['Users', count('users')],
        ['Disabled users', count('users', { status: 'disabled' })],
        ['Owner memberships', count('business_memberships', { role: 'owner' })],
        ['Forms', count('questionnaires')],
        ['Published forms', count('questionnaires', { publishedVersion: { $gt: 0 } })],
        ['Draft forms', count('questionnaires', { publishedVersion: 0 })],
        ['Responses', count('responses')],
        ['Responses today (UTC)', count('responses', { submittedAt: { $gte: today } })],
        ['Responses this month (UTC)', count('responses', { submittedAt: { $gte: month } })],
        ['QR scans', count('qr_events')],
        ['Contacts', count('contacts')],
        ['Promotions', count('rewards')],
        ['Redeemed promotions', count('rewards', { status: 'redeemed' })],
        [
          'Expired promotions',
          count('rewards', { status: 'issued', expiresAt: { $lte: new Date() } }),
        ],
      ].map(async ([label, value]) => ({ label, value: await value })),
    );
    const [rating] = await mongoose.connection
      .collection('responses')
      .aggregate([
        { $match: { rating: { $type: 'number' } } },
        { $group: { _id: null, average: { $avg: '$rating' } } },
      ])
      .toArray();
    res.json({ data: { metrics: entries, averageRating: rating?.['average'] ?? null } });
  });
  router.get('/admin/system', (_req, res) =>
    res.json({
      data: {
        environment: env.NODE_ENV,
        apiVersion: '0.1.0',
        database: mongoose.connection.readyState === 1 ? 'up' : 'down',
        rateLimitStore: env.RATE_LIMIT_STORE,
      },
    }),
  );
  router.get('/admin/search', async (req, res) => {
    const q = listSchema.parse({ search: req.query['search'], pageSize: 5 });
    if (!q.search) return res.json({ data: [] });
    const groups = await Promise.all(
      (['businesses', 'users', 'forms', 'contacts', 'responses'] as const).map(
        async (resource) => ({ resource, ...(await service.list(resource, q)) }),
      ),
    );
    res.json({ data: groups });
  });
  router.get('/admin/users/:id/memberships', async (req, res) => {
    const userId = id(req.params['id']);
    await service.detail('users', userId);
    res.json(await service.memberships('user', userId, listSchema.parse(req.query)));
  });
  router.post('/admin/promotions/:id/:action', async (req, res) => {
    const target = id(req.params['id']);
    const action = z.enum(['approve', 'reject', 'cancel']).parse(req.params['action']);
    const { confirm, ...body } = z
      .object({ confirm: z.literal(true), note: z.string().max(500).optional() })
      .strict()
      .parse(req.body);
    void confirm;
    const { note } = decisionSchema.parse(body);
    const before = await service.detail('promotions', target);
    const businessId = String(before['businessId']);
    const log = await service.audit(
      req.auth!.userId,
      'promotions',
      target,
      `PROMOTION_${action.toUpperCase()}`,
      { status: before['status'] },
      { action },
      businessId,
    );
    try {
      const fn = {
        approve: rewardService.approveReward,
        reject: rewardService.rejectReward,
        cancel: rewardService.cancelReward,
      }[action];
      const data = await fn(businessId, req.auth!.userId, target, note);
      await log.updateOne({ outcome: 'completed' });
      res.json({ data });
    } catch (err) {
      await log.updateOne({ outcome: 'failed' });
      throw err;
    }
  });
  router.get('/admin/businesses/:id/members', async (req, res) => {
    const businessId = id(req.params['id']);
    await service.detail('businesses', businessId);
    res.json(await service.memberships('business', businessId, listSchema.parse(req.query)));
  });
  router.patch('/admin/businesses/:id/members/:memberId', async (req, res) => {
    const businessId = id(req.params['id']);
    const memberId = id(req.params['memberId']);
    const input = z
      .object({
        status: z.enum(['active', 'disabled']).optional(),
        role: z.enum(['owner', 'member']).optional(),
        confirm: z.literal(true),
      })
      .strict()
      .refine((v) => !!v.status !== !!v.role, 'Choose either a status or a role change')
      .parse(req.body);
    const { confirm, ...change } = input;
    void confirm;
    res.json({
      data: await actions.membershipAction(req.auth!.userId, businessId, memberId, change),
    });
  });
  router.delete('/admin/businesses/:id/members/:memberId', async (req, res) => {
    const businessId = id(req.params['id']);
    const memberId = id(req.params['memberId']);
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    res.json({
      data: await actions.membershipAction(req.auth!.userId, businessId, memberId, {
        remove: true,
      }),
    });
  });
  router.get('/admin/businesses/:id/qr.:format', async (req, res) => {
    const business = await service.detail('businesses', id(req.params['id']));
    const format = z.enum(['svg', 'png']).parse(req.params['format']);
    const url = publicUrlFor(String(business['slug']));
    res.attachment(`${business['slug']}-qr.${format}`);
    if (format === 'svg')
      res
        .type('image/svg+xml')
        .send(await QRCode.toString(url, { type: 'svg', margin: 4, width: 1024 }));
    else res.type('png').send(await QRCode.toBuffer(url, { type: 'png', margin: 4, width: 1024 }));
  });
  router.get('/admin/businesses/:id/qr', async (req, res) => {
    const business = await service.detail('businesses', id(req.params['id']));
    res.json({
      data: { publicUrl: publicUrlFor(String(business['slug'])), slug: business['slug'] },
    });
  });
  router.post('/admin/forms/:id/:action', async (req, res) => {
    const target = id(req.params['id']);
    const action = z.enum(['publish', 'archive', 'restore']).parse(req.params['action']);
    const input = z
      .object({
        confirm: z.literal(true),
        expectedRevision: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    const before = await service.detail('forms', target);
    const businessId = String(before['businessId']);
    const revision =
      action === 'publish' ? z.number().int().positive().parse(input.expectedRevision) : undefined;
    const log = await service.audit(
      req.auth!.userId,
      'forms',
      target,
      `FORM_${action.toUpperCase()}`,
      {
        adminArchived: before['adminArchived'] ?? false,
        publishedVersion: before['publishedVersion'],
      },
      { action, expectedRevision: revision },
      businessId,
    );
    try {
      if (action === 'publish') await publish(businessId, req.auth!.userId, revision!);
      else await Questionnaire.updateOne({ _id: target }, { adminArchived: action === 'archive' });
      await log.updateOne({ outcome: 'completed' });
      res.json({ data: await service.detail('forms', target) });
    } catch (err) {
      await log.updateOne({ outcome: 'failed' });
      throw err;
    }
  });
  router.get('/admin/forms/:id/versions', async (req, res) => {
    const form = await service.detail('forms', id(req.params['id']));
    const q = listSchema.parse(req.query);
    const filter = {
      questionnaireId: form._id,
      ...(q.search ? { title: { $regex: escapeRegex(q.search), $options: 'i' } } : {}),
      ...(q.from || q.to
        ? {
            publishedAt: {
              ...(q.from ? { $gte: new Date(q.from) } : {}),
              ...(q.to ? { $lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      QuestionnaireVersion.find(filter)
        .sort({ version: q.direction === 'asc' ? 1 : -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      QuestionnaireVersion.countDocuments(filter),
    ]);
    res.json({ data, pagination: pageMeta(q.page, q.pageSize, total) });
  });
  router.patch('/admin/businesses/:id', async (req, res) => {
    const target = id(req.params['id']);
    const patch = updateBusinessSchema.parse(req.body);
    const before = await service.detail('businesses', target);
    const log = await service.audit(
      req.auth!.userId,
      'businesses',
      target,
      'BUSINESS_UPDATED',
      Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])),
      patch,
      target,
    );
    await Business.updateOne({ _id: target }, { $set: patch }, { runValidators: true });
    await log.updateOne({ outcome: 'completed' });
    res.json({ data: await service.detail('businesses', target) });
  });
  router.post('/admin/businesses/:id/state', async (req, res) => {
    const target = id(req.params['id']);
    const { state } = z
      .object({ state: z.enum(['active', 'suspended', 'archived']), confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    await actions.businessState(req.auth!.userId, target, state);
    res.json({ data: await service.detail('businesses', target) });
  });
  router.post('/admin/users/:id/action', async (req, res) => {
    const target = id(req.params['id']);
    const { action } = z
      .object({
        action: z.enum(['enable', 'disable', 'block', 'unblock', 'revoke-sessions']),
        confirm: z.literal(true),
      })
      .strict()
      .parse(req.body);
    await actions.userAction(
      req.auth!.userId,
      target,
      action === 'block' ? 'disable' : action === 'unblock' ? 'enable' : action,
    );
    res.json({ data: await service.detail('users', target) });
  });
  router.patch('/admin/users/:id/role', async (req, res) => {
    const target = id(req.params['id']);
    const { platformRole } = z
      .object({ platformRole: z.enum(['USER', 'SUPER_ADMIN']), confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    await actions.platformRole(req.auth!.userId, target, platformRole);
    res.json({ data: await service.detail('users', target) });
  });
  for (const resource of Object.keys(service.resources) as service.Resource[]) {
    router.get(`/admin/${resource}`, async (req, res) =>
      res.json(await service.list(resource, listSchema.parse(req.query))),
    );
    router.get(`/admin/${resource}/:id`, async (req, res) =>
      res.json({ data: await service.detail(resource, id(req.params['id'])) }),
    );
  }
  return router;
}
