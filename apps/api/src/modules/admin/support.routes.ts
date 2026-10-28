import { Router, type Request } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { User } from '../auth/user.model';
import { verifyPassword } from '../auth/password';
import { Business } from '../businesses/business.model';
import { findMembership } from '../businesses/business.service';
import { updateBusinessSchema } from '../businesses/business.schemas';
import { publish } from '../questionnaires/questionnaire.service';
import * as rewardService from '../rewards/reward.service';
import { decisionSchema } from '../rewards/reward.schemas';
import { AppError, forbidden, notFound } from '../../shared/errors';
import { pageMeta, paginationQuery } from '../../shared/pagination';
import { idSchema, listSchema } from './admin.schemas';
import * as service from './admin.service';
import {
  AdminReauth,
  SUPPORT_MODES,
  SUPPORT_SCOPES,
  SupportAccessLog,
  SupportGrant,
} from './support.model';
import {
  MAX_EMERGENCY_MINUTES,
  MAX_GRANT_MINUTES,
  REAUTH_TTL_MS,
  REQUEST_TTL_MS,
  authorizeGrant,
  effectiveStatus,
  hasRecentReauth,
  logAccess,
  routeOf,
} from './support-access';

const SUPPORT_PAGE_MAX = 25;
const ticket = z.string().trim().min(3).max(80);
const scopes = z.array(z.enum(SUPPORT_SCOPES)).min(1).max(SUPPORT_SCOPES.length);

const grantDto = (g: Record<string, unknown> & { status: string }) => ({
  id: String(g['_id']),
  businessId: String(g['businessId']),
  requestedBy: String(g['requestedBy']),
  ticketRef: g['ticketRef'],
  reason: g['reason'],
  scopes: g['scopes'],
  mode: g['mode'],
  durationMinutes: g['durationMinutes'],
  status: effectiveStatus(g as never),
  emergency: g['emergency'] ?? false,
  review: g['review'] ?? null,
  approvedAt: g['approvedAt'] ?? null,
  expiresAt: g['expiresAt'] ?? null,
  endedAt: g['endedAt'] ?? null,
  createdAt: g['createdAt'],
});

/** Default-deny stubs for removed platform-wide customer-data routes. Denials are audited. */
async function denyRestricted(req: Request) {
  await logAccess({
    actorUserId: req.auth!.userId,
    actorRole: 'SUPER_ADMIN',
    event: 'RESTRICTED_ROUTE',
    outcome: 'denied',
    reason: 'CUSTOMER_DATA_NOT_PLATFORM_ACCESSIBLE',
    route: routeOf(req),
  });
  throw new AppError(
    403,
    'CUSTOMER_DATA_RESTRICTED',
    'Tenant customer data is not available to platform administrators. Request business-approved support access.',
  );
}

export function registerSupportAdminRoutes(router: Router) {
  for (const path of ['responses', 'contacts', 'promotions'])
    router.all([`/admin/${path}`, `/admin/${path}/*splat`], (req, _res, next) =>
      denyRestricted(req).catch(next),
    );

  router.post('/admin/reauth', async (req, res) => {
    const { password } = z
      .object({ password: z.string().min(1).max(200) })
      .strict()
      .parse(req.body);
    const actor = req.auth!.userId;
    const since = new Date(Date.now() - 15 * 60_000);
    const failures = await SupportAccessLog.countDocuments({
      actorUserId: actor,
      event: 'REAUTH',
      outcome: 'denied',
      at: { $gte: since },
    });
    if (failures >= 5)
      throw new AppError(429, 'REAUTH_LOCKED', 'Too many failed attempts. Try again later.');
    const user = await User.findById(actor, { passwordHash: 1, sessionVersion: 1 }).lean();
    const ok = !!user && (await verifyPassword(password, user.passwordHash));
    await logAccess({
      actorUserId: actor,
      actorRole: 'SUPER_ADMIN',
      event: 'REAUTH',
      outcome: ok ? 'allowed' : 'denied',
      reason: ok ? undefined : 'BAD_PASSWORD',
      route: routeOf(req),
    });
    if (!ok) throw forbidden('Password confirmation failed');
    const expiresAt = new Date(Date.now() + REAUTH_TTL_MS);
    await AdminReauth.create({
      userId: actor,
      sessionVersion: user.sessionVersion ?? 0,
      expiresAt,
    });
    res.json({ data: { expiresAt } });
  });

  router.post('/admin/support-grants', async (req, res) => {
    const input = z
      .object({
        businessId: idSchema,
        ticketRef: ticket,
        reason: z.string().trim().min(10).max(1000),
        scopes,
        mode: z.enum(SUPPORT_MODES).default('read'),
        durationMinutes: z.number().int().min(15).max(MAX_GRANT_MINUTES).default(60),
      })
      .strict()
      .parse(req.body);
    if (!(await Business.exists({ _id: input.businessId }))) throw notFound('Business not found');
    const grant = await SupportGrant.create({
      ...input,
      scopes: [...new Set(input.scopes)],
      requestedBy: req.auth!.userId,
      requestExpiresAt: new Date(Date.now() + REQUEST_TTL_MS),
      review: { status: 'not_required' },
    });
    await logAccess({
      actorUserId: req.auth!.userId,
      actorRole: 'SUPER_ADMIN',
      businessId: input.businessId,
      grantId: grant._id,
      event: 'GRANT_REQUESTED',
      outcome: 'allowed',
      operation: input.mode,
      ticketRef: input.ticketRef,
      route: routeOf(req),
    });
    res.status(201).json({ data: grantDto(grant.toObject()) });
  });

  router.post('/admin/support-grants/emergency', async (req, res) => {
    const actor = req.auth!.userId;
    const input = z
      .object({
        businessId: idSchema,
        ticketRef: ticket,
        justification: z.string().trim().min(40).max(1000),
        scopes,
        durationMinutes: z.number().int().min(15).max(MAX_EMERGENCY_MINUTES).default(30),
      })
      .strict()
      .parse(req.body);
    const user = await User.findById(actor, { permissions: 1 }).lean();
    const deny = async (reason: string) => {
      await logAccess({
        actorUserId: actor,
        actorRole: 'SUPER_ADMIN',
        businessId: input.businessId,
        event: 'EMERGENCY_ACCESS',
        outcome: 'denied',
        reason,
        route: routeOf(req),
      });
      throw forbidden('Emergency access is not available');
    };
    if (!user?.permissions?.includes('support:emergency')) return deny('NO_EMERGENCY_PERMISSION');
    if (!(await hasRecentReauth(actor))) return deny('REAUTH_REQUIRED');
    if (!(await Business.exists({ _id: input.businessId }))) throw notFound('Business not found');
    const now = Date.now();
    const grant = await SupportGrant.create({
      businessId: input.businessId,
      requestedBy: actor,
      ticketRef: input.ticketRef,
      reason: input.justification,
      scopes: [...new Set(input.scopes)],
      mode: 'read',
      durationMinutes: input.durationMinutes,
      status: 'active',
      requestExpiresAt: new Date(now),
      approvedAt: new Date(now),
      expiresAt: new Date(now + input.durationMinutes * 60_000),
      emergency: true,
      review: { status: 'pending' },
    });
    await logAccess({
      actorUserId: actor,
      actorRole: 'SUPER_ADMIN',
      businessId: input.businessId,
      grantId: grant._id,
      event: 'EMERGENCY_ACCESS',
      outcome: 'allowed',
      operation: 'read',
      ticketRef: input.ticketRef,
      route: routeOf(req),
    });
    res.status(201).json({ data: grantDto(grant.toObject()) });
  });

  router.get('/admin/support-grants', async (req, res) => {
    const q = z
      .object({
        ...paginationQuery,
        businessId: idSchema.optional(),
        reviewStatus: z.enum(['pending', 'accepted', 'escalated']).optional(),
      })
      .parse(req.query);
    const filter = {
      ...(q.businessId ? { businessId: q.businessId } : {}),
      ...(q.reviewStatus ? { emergency: true, 'review.status': q.reviewStatus } : {}),
    };
    const [data, total] = await Promise.all([
      SupportGrant.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      SupportGrant.countDocuments(filter),
    ]);
    res.json({
      data: data.map((g) => grantDto(g as never)),
      pagination: pageMeta(q.page, q.pageSize, total),
    });
  });

  router.post('/admin/support-grants/:id/cancel', async (req, res) => {
    const grant = await SupportGrant.findOneAndUpdate(
      {
        _id: idSchema.parse(req.params['id']),
        requestedBy: req.auth!.userId,
        status: { $in: ['pending', 'active'] },
      },
      { status: 'cancelled', endedAt: new Date() },
      { returnDocument: 'after' },
    ).lean();
    if (!grant) throw notFound('Grant not found');
    await logAccess({
      actorUserId: req.auth!.userId,
      actorRole: 'SUPER_ADMIN',
      businessId: grant.businessId,
      grantId: grant._id,
      event: 'GRANT_CANCELLED',
      outcome: 'allowed',
      route: routeOf(req),
    });
    res.json({ data: grantDto(grant as never) });
  });

  /** Emergency access needs a second administrator to review it. */
  router.post('/admin/support-grants/:id/review', async (req, res) => {
    const input = z
      .object({
        outcome: z.enum(['accepted', 'escalated']),
        notes: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(req.body);
    const actor = req.auth!.userId;
    const grant = await SupportGrant.findOne({
      _id: idSchema.parse(req.params['id']),
      emergency: true,
      'review.status': 'pending',
    }).lean();
    if (!grant) throw notFound('Grant awaiting review not found');
    if (String(grant.requestedBy) === actor) {
      await logAccess({
        actorUserId: actor,
        actorRole: 'SUPER_ADMIN',
        businessId: grant.businessId,
        grantId: grant._id,
        event: 'EMERGENCY_REVIEW',
        outcome: 'denied',
        reason: 'SELF_REVIEW',
        route: routeOf(req),
      });
      throw forbidden('A different administrator must review emergency access');
    }
    const updated = await SupportGrant.findOneAndUpdate(
      { _id: grant._id, 'review.status': 'pending' },
      {
        $set: {
          'review.status': input.outcome,
          'review.reviewedBy': actor,
          'review.reviewedAt': new Date(),
          'review.notes': input.notes,
        },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!updated) throw new AppError(409, 'ALREADY_REVIEWED', 'This access was already reviewed');
    await logAccess({
      actorUserId: actor,
      actorRole: 'SUPER_ADMIN',
      businessId: grant.businessId,
      grantId: grant._id,
      event: 'EMERGENCY_REVIEW',
      outcome: 'allowed',
      operation: input.outcome,
      route: routeOf(req),
    });
    res.json({ data: grantDto(updated as never) });
  });

  router.get('/admin/support-log', async (req, res) => {
    const q = z
      .object({ ...paginationQuery, businessId: idSchema.optional(), grantId: idSchema.optional() })
      .parse(req.query);
    const filter = {
      ...(q.businessId ? { businessId: q.businessId } : {}),
      ...(q.grantId ? { grantId: q.grantId } : {}),
    };
    const [data, total] = await Promise.all([
      SupportAccessLog.find(filter)
        .sort({ at: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      SupportAccessLog.countDocuments(filter),
    ]);
    res.json({ data, pagination: pageMeta(q.page, q.pageSize, total) });
  });

  // ---- Grant-gated access to tenant-owned data ---------------------------------------------
  const scoped = (
    resource: service.RestrictedResource,
    scope: 'responses' | 'contacts' | 'rewards',
    path: string,
  ) => {
    router.get(`/admin/support/:grantId/${path}`, async (req, res) => {
      const grant = await authorizeGrant(req, String(req.params['grantId']), {
        scope,
        operation: 'read',
      });
      const q = listSchema.parse(req.query);
      const pageSize = Math.min(q.pageSize, SUPPORT_PAGE_MAX);
      res
        .set('Cache-Control', 'no-store')
        .json(
          await service.list(
            resource,
            { ...q, pageSize },
            { businessId: String(grant.businessId) },
          ),
        );
    });
  };
  scoped('responses', 'responses', 'responses');
  scoped('contacts', 'contacts', 'contacts');
  scoped('promotions', 'rewards', 'rewards');

  router.patch('/admin/support/:grantId/business', async (req, res) => {
    const grant = await authorizeGrant(req, String(req.params['grantId']), {
      scope: 'business_profile',
      operation: 'write',
    });
    const patch = updateBusinessSchema.parse(req.body);
    const target = String(grant.businessId);
    const before = await service.detail('businesses', target);
    const log = await service.audit(
      req.auth!.userId,
      'businesses',
      target,
      'BUSINESS_UPDATED_UNDER_GRANT',
      Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])),
      patch,
      target,
    );
    await Business.updateOne({ _id: target }, { $set: patch }, { runValidators: true });
    await log.updateOne({ outcome: 'completed' });
    res.json({ data: await service.detail('businesses', target) });
  });

  router.post('/admin/support/:grantId/forms/:id/publish', async (req, res) => {
    const grant = await authorizeGrant(req, String(req.params['grantId']), {
      scope: 'forms',
      operation: 'write',
    });
    const input = z
      .object({ confirm: z.literal(true), expectedRevision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    const target = idSchema.parse(req.params['id']);
    const form = await service.detail('forms', target);
    if (String(form['businessId']) !== String(grant.businessId)) throw notFound('Record not found');
    const log = await service.audit(
      req.auth!.userId,
      'forms',
      target,
      'FORM_PUBLISH_UNDER_GRANT',
      { publishedVersion: form['publishedVersion'] },
      { expectedRevision: input.expectedRevision },
      String(grant.businessId),
    );
    try {
      await publish(String(grant.businessId), req.auth!.userId, input.expectedRevision);
      await log.updateOne({ outcome: 'completed' });
    } catch (err) {
      await log.updateOne({ outcome: 'failed' });
      throw err;
    }
    res.json({ data: await service.detail('forms', target) });
  });

  router.post('/admin/support/:grantId/rewards/:id/:action', async (req, res) => {
    const grant = await authorizeGrant(req, String(req.params['grantId']), {
      scope: 'rewards',
      operation: 'write',
    });
    const target = idSchema.parse(req.params['id']);
    const action = z.enum(['approve', 'reject', 'cancel']).parse(req.params['action']);
    const { confirm, ...body } = z
      .object({ confirm: z.literal(true), note: z.string().max(500).optional() })
      .strict()
      .parse(req.body);
    void confirm;
    const { note } = decisionSchema.parse(body);
    const businessId = String(grant.businessId);
    const before = await service.detail('promotions', target, { businessId });
    // Audit records the transition only; the optional note may contain customer details.
    const log = await service.audit(
      req.auth!.userId,
      'promotions',
      target,
      `PROMOTION_${action.toUpperCase()}_UNDER_GRANT`,
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
}

/** Business-owner side: review, approve, deny and revoke access to their own tenant's data. */
export function createSupportOwnerRouter() {
  const router = Router();
  const base = '/businesses/:businessId/support-grants';
  const guard = [
    requireAuth,
    requireBusinessAccess(findMembership),
    (req: Request, res: import('express').Response, next: import('express').NextFunction) => {
      res.set('Cache-Control', 'no-store');
      if (req.tenant?.role !== 'owner')
        return next(forbidden('Only business owners manage support access'));
      next();
    },
  ];
  const own = async (req: Request) => {
    const grant = await SupportGrant.findOne({
      _id: idSchema.parse(req.params['grantId']),
      businessId: req.tenant!.businessId,
    }).lean();
    if (!grant) throw notFound('Grant not found');
    return grant;
  };
  const record = (req: Request, event: string, grant: { _id: Types.ObjectId; ticketRef: string }) =>
    logAccess({
      actorUserId: req.auth!.userId,
      actorRole: 'OWNER',
      businessId: req.tenant!.businessId,
      grantId: grant._id,
      event,
      outcome: 'allowed',
      ticketRef: grant.ticketRef,
      route: routeOf(req),
    });

  router.get(base, ...guard, async (req, res) => {
    const q = z.object(paginationQuery).parse(req.query);
    const filter = { businessId: req.tenant!.businessId };
    const [data, total] = await Promise.all([
      SupportGrant.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      SupportGrant.countDocuments(filter),
    ]);
    res.json({
      data: data.map((g) => grantDto(g as never)),
      pagination: pageMeta(q.page, q.pageSize, total),
    });
  });

  router.post(`${base}/:grantId/approve`, ...guard, async (req, res) => {
    const input = z
      .object({ password: z.string().min(1).max(200).optional() })
      .strict()
      .parse(req.body);
    const grant = await own(req);
    if (effectiveStatus(grant) !== 'pending')
      throw new AppError(409, 'GRANT_NOT_PENDING', 'This request can no longer be approved');
    if (grant.mode === 'write') {
      const user = await User.findById(req.auth!.userId, { passwordHash: 1 }).lean();
      if (!input.password || !user || !(await verifyPassword(input.password, user.passwordHash)))
        throw new AppError(403, 'REAUTH_REQUIRED', 'Confirm your password to approve write access');
    }
    const now = Date.now();
    const updated = await SupportGrant.findOneAndUpdate(
      { _id: grant._id, status: 'pending', requestExpiresAt: { $gt: new Date() } },
      {
        status: 'active',
        approvedBy: req.auth!.userId,
        approvedAt: new Date(now),
        expiresAt: new Date(now + grant.durationMinutes * 60_000),
      },
      { returnDocument: 'after' },
    ).lean();
    if (!updated)
      throw new AppError(409, 'GRANT_NOT_PENDING', 'This request can no longer be approved');
    await record(req, 'GRANT_APPROVED', grant);
    res.json({ data: grantDto(updated as never) });
  });

  for (const [action, status] of [
    ['deny', 'denied'],
    ['revoke', 'revoked'],
  ] as const)
    router.post(`${base}/:grantId/${action}`, ...guard, async (req, res) => {
      const grant = await own(req);
      const updated = await SupportGrant.findOneAndUpdate(
        { _id: grant._id, status: action === 'deny' ? 'pending' : { $in: ['pending', 'active'] } },
        { status, endedAt: new Date() },
        { returnDocument: 'after' },
      ).lean();
      if (!updated) throw new AppError(409, 'GRANT_NOT_ACTIVE', 'This grant is already closed');
      await record(req, `GRANT_${status.toUpperCase()}`, grant);
      res.json({ data: grantDto(updated as never) });
    });

  router.get(`${base}/:grantId/log`, ...guard, async (req, res) => {
    const grant = await own(req);
    const q = z.object(paginationQuery).parse(req.query);
    const filter = { grantId: grant._id };
    const [data, total] = await Promise.all([
      SupportAccessLog.find(filter, { actorUserId: 0 })
        .sort({ at: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      SupportAccessLog.countDocuments(filter),
    ]);
    res.json({ data, pagination: pageMeta(q.page, q.pageSize, total) });
  });
  return router;
}
