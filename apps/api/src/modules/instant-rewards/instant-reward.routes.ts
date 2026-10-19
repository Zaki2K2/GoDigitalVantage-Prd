import { recordEmailReceipt } from '../email/email.model';
import { Router, raw } from 'express';
import { AppError } from '../../shared/errors';
import { z } from 'zod';
import { requireAuth } from '../../middleware/require-auth';
import {
  createInstantRewardLimiter,
  createInstantRewardSendLimiter,
} from '../../middleware/rate-limit';
import { idSchema, listSchema } from '../admin/admin.schemas';
import { User } from '../auth/user.model';
import { escapeRegex } from '../../shared/pagination';
import { requireInstantRewardAdmin } from './instant-reward.auth';
import { InstantRewardsService } from './instant-reward.service';
import { verifyEmailWebhook } from './instant-reward.email';
import {
  createInstantRewardSchema,
  editInstantRewardSchema,
  operationSchema,
  adminActionSchema,
  tokenBody,
  claimBody,
  rewardListSchema,
} from './instant-reward.schemas';
export function createInstantRewardRouter(service: InstantRewardsService) {
  const router = Router();
  const base = '/instant-rewards';
  const admin = `${base}/admin`;
  router.use(base, requireAuth, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  router.use(admin, requireInstantRewardAdmin, createInstantRewardSendLimiter());
  const actor = (id: string) => ({ id, type: 'ADMIN' as const });
  router.get(`${admin}/summary`, async (_req, res) => res.json({ data: await service.summary() }));
  router.get(`${admin}/users`, async (req, res) => {
    const q = listSchema.parse(req.query);
    const users = await User.find(
      {
        status: 'active',
        ...(q.search
          ? {
              $or: ['fullName', 'emailLowercase'].map((key) => ({
                [key]: { $regex: escapeRegex(q.search), $options: 'i' },
              })),
            }
          : {}),
      },
      { fullName: 1, emailLowercase: 1 },
    )
      .sort({ emailLowercase: 1 })
      .limit(20)
      .lean();
    res.json({
      data: users.map((u) => ({ id: String(u._id), name: u.fullName, email: u.emailLowercase })),
    });
  });
  router.get(admin, async (req, res) =>
    res.json(await service.list(rewardListSchema.parse(req.query))),
  );
  router.post(admin, async (req, res) => {
    const result = await service.create(
      actor(req.auth!.userId),
      createInstantRewardSchema.parse(req.body),
    );
    res
      .status(result.created ? 201 : 200)
      .json({ data: result.reward, sendError: result.sendError });
  });
  router.get(`${admin}/:id/audit`, async (req, res) => {
    const q = listSchema.parse(req.query);
    res.json(await service.history(idSchema.parse(req.params['id']), q.page, q.pageSize));
  });
  router.get(`${admin}/:id`, async (req, res) =>
    res.json({ data: service.dto(await service.get(idSchema.parse(req.params['id'])), true) }),
  );
  router.patch(`${admin}/:id`, async (req, res) =>
    res.json({
      data: service.dto(
        await service.edit(
          idSchema.parse(req.params['id']),
          actor(req.auth!.userId),
          editInstantRewardSchema.parse(req.body),
        ),
        true,
      ),
    }),
  );
  for (const action of ['send', 'resend'] as const)
    router.post(`${admin}/:id/${action}`, async (req, res) => {
      const body = operationSchema.parse(req.body);
      res.json({
        data: service.dto(
          await service.send(
            idSchema.parse(req.params['id']),
            actor(req.auth!.userId),
            body.requestId,
          ),
          true,
        ),
      });
    });
  for (const action of ['enable', 'disable', 'revoke'] as const)
    router.post(`${admin}/:id/${action}`, async (req, res) => {
      const body = adminActionSchema.parse(req.body);
      res.json({
        data: service.dto(
          await service.action(
            idSchema.parse(req.params['id']),
            actor(req.auth!.userId),
            action,
            body.reason,
          ),
          true,
        ),
      });
    });
  const limit = createInstantRewardLimiter();
  router.get(`${base}/mine`, async (req, res) => {
    const q = rewardListSchema.parse(req.query);
    res.json(await service.list({ ...q, recipientUserId: undefined }, req.auth!.userId));
  });
  router.post(`${base}/view`, limit, async (req, res) =>
    res.json({ data: await service.view(tokenBody.parse(req.body).token, req.auth!.userId) }),
  );
  router.post(`${base}/request-verification`, limit, async (req, res) => {
    const body = z
      .object({ token: tokenBody.shape.token, requestId: z.uuid() })
      .strict()
      .parse(req.body);
    res.json({
      data: service.dto(
        await service.requestVerification(body.token, req.auth!.userId, body.requestId),
        false,
        req.auth!.userId,
        true,
      ),
    });
  });
  router.post(`${base}/verify`, limit, async (req, res) =>
    res.json({
      data: service.dto(
        await service.verify(tokenBody.parse(req.body).token, req.auth!.userId),
        false,
        req.auth!.userId,
      ),
    }),
  );
  router.post(`${base}/claim`, limit, async (req, res) => {
    const result = await service.claim(claimBody.parse(req.body), req.auth!.userId);
    res.json({
      data: service.dto(result.reward, false, req.auth!.userId),
      replayed: result.replayed,
    });
  });
  router.post(`${base}/:id/request-link`, limit, async (req, res) => {
    const body = operationSchema.parse(req.body);
    res.json({
      data: service.dto(
        await service.requestLink(
          idSchema.parse(req.params['id']),
          req.auth!.userId,
          body.requestId,
        ),
        false,
        req.auth!.userId,
      ),
    });
  });
  return router;
}
export function createInstantRewardWebhook(service: InstantRewardsService) {
  const router = Router();
  router.post(
    ['/api/v1/webhooks/instant-rewards/email', '/api/v1/webhooks/resend'],
    raw({ type: 'application/json', limit: '100kb' }),
    async (req, res) => {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body))
        return res
          .status(400)
          .json({ error: { code: 'INVALID_WEBHOOK', message: 'Expected JSON' } });
      verifyEmailWebhook(
        body,
        req.get('svix-id'),
        req.get('svix-timestamp'),
        req.get('svix-signature'),
      );
      let decoded: unknown;
      try {
        decoded = JSON.parse(body.toString('utf8'));
      } catch {
        throw new AppError(400, 'INVALID_WEBHOOK', 'Invalid webhook JSON');
      }
      const payload = z
        .object({
          type: z.string(),
          created_at: z.iso.datetime(),
          data: z.object({ email_id: z.string().max(200) }),
        })
        .parse(decoded);
      if (
        [
          'email.delivered',
          'email.bounced',
          'email.failed',
          'email.complained',
          'email.suppressed',
        ].includes(payload.type)
      ) {
        await recordEmailReceipt(
          req.get('svix-id')!,
          payload.data.email_id,
          payload.type,
          new Date(payload.created_at),
        );
        try {
          await service.deliveryEvent(
            payload.data.email_id,
            payload.type,
            req.get('svix-id')!,
            new Date(payload.created_at),
          );
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'DELIVERY_NOT_READY') throw error;
        }
      }
      return res.json({ received: true });
    },
  );
  return router;
}
