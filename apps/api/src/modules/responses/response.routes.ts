import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { dashboardQuery, getDashboard } from '../analytics/dashboard.service';
import { findMembership } from '../businesses/business.service';
import { getContact, listContacts, listContactsQuery } from '../contacts/contact.service';
import { listResponsesQuery } from './response.schemas';
import { getResponse, listResponses } from './response.service';

/**
 * Read-only portal views over responses, contacts and the dashboard. Deliberately GET-only:
 * responses are immutable and contacts are only created by public submissions.
 */
export function createCrmRouter() {
  const router = Router();
  const access = [requireAuth, requireBusinessAccess(findMembership)];
  const id = (v: unknown) => (typeof v === 'string' ? v : '');

  router.get('/businesses/:businessId/responses', ...access, async (req, res) => {
    const q = listResponsesQuery.parse(req.query);
    res.json(await listResponses(req.tenant!.businessId, q));
  });

  router.get('/businesses/:businessId/responses/:responseId', ...access, async (req, res) => {
    res.json({ data: await getResponse(req.tenant!.businessId, id(req.params['responseId'])) });
  });

  router.get('/businesses/:businessId/contacts', ...access, async (req, res) => {
    const q = listContactsQuery.parse(req.query);
    res.json(await listContacts(req.tenant!.businessId, q));
  });

  router.get('/businesses/:businessId/contacts/:contactId', ...access, async (req, res) => {
    res.json({ data: await getContact(req.tenant!.businessId, id(req.params['contactId'])) });
  });

  router.get('/businesses/:businessId/dashboard', ...access, async (req, res) => {
    const q = dashboardQuery.parse(req.query);
    res.json({ data: await getDashboard(req.tenant!.businessId, q.days) });
  });

  return router;
}
