import { Router } from 'express';
import { forbidden } from '../../shared/errors';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { findMembership } from '../businesses/business.service';
import { publishSchema, saveDraftSchema, versionParam } from './questionnaire.schemas';
import * as service from './questionnaire.service';

export function createQuestionnaireRouter() {
  const router = Router();
  const access = [requireAuth, requireBusinessAccess(findMembership)];
  const base = '/businesses/:businessId/questionnaire';

  router.get(base, ...access, async (req, res) => {
    res.json({ data: { questionnaire: await service.getQuestionnaire(req.tenant!.businessId) } });
  });

  router.put(`${base}/draft`, ...access, async (req, res) => {
    if (req.tenant!.role !== 'owner') throw forbidden('Only the owner can edit the questionnaire');
    const input = saveDraftSchema.parse(req.body);
    res.json({ data: { questionnaire: await service.saveDraft(req.tenant!.businessId, input) } });
  });

  router.post(`${base}/publish`, ...access, async (req, res) => {
    if (req.tenant!.role !== 'owner') throw forbidden('Only the owner can publish');
    const { expectedRevision } = publishSchema.parse(req.body);
    const questionnaire = await service.publish(
      req.tenant!.businessId,
      req.auth!.userId,
      expectedRevision,
    );
    res.json({ data: { questionnaire } });
  });

  router.get(`${base}/versions/:version`, ...access, async (req, res) => {
    const { version } = versionParam.parse(req.params);
    res.json({ data: { version: await service.getVersion(req.tenant!.businessId, version) } });
  });

  return router;
}
