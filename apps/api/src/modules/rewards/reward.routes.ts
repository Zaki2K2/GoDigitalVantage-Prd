import { Router } from 'express';
import { createRewardLookupLimiter } from '../../middleware/rate-limit';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { findMembership } from '../businesses/business.service';
import {
  codeSchema,
  createRuleSchema,
  decisionSchema,
  deliverSchema,
  issueSchema,
  listIncidentsQuery,
  listRewardsQuery,
  redeemSchema,
  summaryQuery,
  updateRuleSchema,
} from './reward.schemas';
import * as svc from './reward.service';

/**
 * Rewards portal API. Every route needs a membership on the business.
 * Owners manage rules and decisions (approve, reject, cancel, manual issue);
 * any member (staff) can look up, share and redeem codes.
 */
export function createRewardRouter() {
  const router = Router();
  const access = [requireAuth, requireBusinessAccess(findMembership)];
  const lookupLimit = createRewardLookupLimiter();
  const p = (v: unknown) => (typeof v === 'string' ? v : '');

  router.get('/businesses/:businessId/rewards/templates', ...access, (_req, res) => {
    res.json({ data: svc.TEMPLATES });
  });
  router.get('/businesses/:businessId/rewards/summary', ...access, async (req, res) => {
    res.json({ data: await svc.getSummary(req.tenant!.businessId, summaryQuery.parse(req.query)) });
  });

  // ---- rules (owner writes)
  router.get('/businesses/:businessId/reward-rules', ...access, async (req, res) => {
    res.json({ data: await svc.listRules(req.tenant!.businessId) });
  });
  router.post('/businesses/:businessId/reward-rules', ...access, async (req, res) => {
    svc.assertOwner(req.tenant!.role);
    const input = createRuleSchema.parse(req.body);
    res
      .status(201)
      .json({ data: await svc.createRule(req.tenant!.businessId, req.auth!.userId, input) });
  });
  router.patch('/businesses/:businessId/reward-rules/:ruleId', ...access, async (req, res) => {
    svc.assertOwner(req.tenant!.role);
    const patch = updateRuleSchema.parse(req.body);
    res.json({
      data: await svc.updateRule(
        req.tenant!.businessId,
        req.auth!.userId,
        p(req.params['ruleId']),
        patch,
      ),
    });
  });

  // ---- incidents
  router.get('/businesses/:businessId/incidents', ...access, async (req, res) => {
    res.json(await svc.listIncidents(req.tenant!.businessId, listIncidentsQuery.parse(req.query)));
  });
  router.post(
    '/businesses/:businessId/incidents/:incidentId/issue',
    ...access,
    async (req, res) => {
      svc.assertOwner(req.tenant!.role);
      const { ruleId } = issueSchema.parse(req.body);
      res.status(201).json({
        data: await svc.issueManually(
          req.tenant!.businessId,
          req.auth!.userId,
          p(req.params['incidentId']),
          ruleId,
        ),
      });
    },
  );
  router.post(
    '/businesses/:businessId/incidents/:incidentId/resolve',
    ...access,
    async (req, res) => {
      svc.assertOwner(req.tenant!.role);
      const { note } = decisionSchema.parse(req.body);
      res.json({
        data: await svc.resolveIncident(
          req.tenant!.businessId,
          req.auth!.userId,
          p(req.params['incidentId']),
          note,
        ),
      });
    },
  );

  // ---- rewards
  router.get('/businesses/:businessId/rewards', ...access, async (req, res) => {
    res.json(await svc.listRewards(req.tenant!.businessId, listRewardsQuery.parse(req.query)));
  });
  router.post(
    '/businesses/:businessId/rewards/verify',
    ...access,
    lookupLimit,
    async (req, res) => {
      const { code } = codeSchema.parse(req.body);
      res.json({ data: await svc.verifyCode(req.tenant!.businessId, code) });
    },
  );
  router.post(
    '/businesses/:businessId/rewards/redeem',
    ...access,
    lookupLimit,
    async (req, res) => {
      const input = redeemSchema.parse(req.body);
      const result = await svc.redeem(
        req.tenant!.businessId,
        req.auth!.userId,
        input.code,
        input.requestId,
        input.orderTotal,
      );
      res.status(result.duplicate ? 200 : 201).json({ data: result });
    },
  );
  router.get('/businesses/:businessId/rewards/:rewardId', ...access, async (req, res) => {
    res.json({ data: await svc.getReward(req.tenant!.businessId, p(req.params['rewardId'])) });
  });
  for (const action of ['approve', 'reject', 'cancel'] as const) {
    router.post(
      `/businesses/:businessId/rewards/:rewardId/${action}`,
      ...access,
      async (req, res) => {
        svc.assertOwner(req.tenant!.role);
        const { note } = decisionSchema.parse(req.body);
        const fn = {
          approve: svc.approveReward,
          reject: svc.rejectReward,
          cancel: svc.cancelReward,
        }[action];
        res.json({
          data: await fn(req.tenant!.businessId, req.auth!.userId, p(req.params['rewardId']), note),
        });
      },
    );
  }
  router.post('/businesses/:businessId/rewards/:rewardId/shared', ...access, async (req, res) => {
    const { method } = deliverSchema.parse(req.body);
    res.json({
      data: await svc.recordShare(
        req.tenant!.businessId,
        req.auth!.userId,
        p(req.params['rewardId']),
        method,
      ),
    });
  });

  return router;
}
