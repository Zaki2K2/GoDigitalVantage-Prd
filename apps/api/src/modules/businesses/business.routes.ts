import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { MEMBERSHIP_ROLES, type MembershipRole } from './membership.model';
import {
  createBusinessSchema,
  updateBusinessSchema,
  updateOnboardingSchema,
} from './business.schemas';
import * as service from './business.service';

export function createBusinessRouter() {
  const router = Router();
  const access = requireBusinessAccess(service.findMembership);
  const roleOf = (role: string | undefined): MembershipRole =>
    MEMBERSHIP_ROLES.find((r) => r === role) ?? 'member';

  router.post('/businesses', requireAuth, async (req, res) => {
    const input = createBusinessSchema.parse(req.body);
    const { business, created } = await service.createBusiness(req.auth!.userId, input);
    res.status(created ? 201 : 200).json({ data: { business } });
  });

  router.get('/businesses', requireAuth, async (req, res) => {
    res.json({ data: { businesses: await service.listBusinesses(req.auth!.userId) } });
  });

  router.get('/businesses/:businessId', requireAuth, access, async (req, res) => {
    const t = req.tenant!;
    res.json({ data: { business: await service.getBusiness(t.businessId, roleOf(t.role)) } });
  });

  router.patch('/businesses/:businessId', requireAuth, access, async (req, res) => {
    const t = req.tenant!;
    const input = updateBusinessSchema.parse(req.body);
    res.json({
      data: { business: await service.updateBusiness(t.businessId, roleOf(t.role), input) },
    });
  });

  router.get('/businesses/:businessId/onboarding', requireAuth, access, async (req, res) => {
    const t = req.tenant!;
    const business = await service.getBusiness(t.businessId, roleOf(t.role));
    res.json({ data: { onboarding: business.onboarding } });
  });

  router.patch('/businesses/:businessId/onboarding', requireAuth, access, async (req, res) => {
    const t = req.tenant!;
    const input = updateOnboardingSchema.parse(req.body);
    const business = await service.updateOnboarding(t.businessId, roleOf(t.role), input);
    res.json({ data: { onboarding: business.onboarding } });
  });

  router.post(
    '/businesses/:businessId/onboarding/finish',
    requireAuth,
    access,
    async (req, res) => {
      const t = req.tenant!;
      const business = await service.finishOnboarding(t.businessId, roleOf(t.role));
      res.json({ data: { business } });
    },
  );

  return router;
}
