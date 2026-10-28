import { Router, raw } from 'express';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { assertBusinessPermission } from '../../middleware/business-permissions';
import { AppError } from '../../shared/errors';
import { findMembership } from '../businesses/business.service';
import {
  followUpConfig,
  handleWhatsAppWebhook,
  listFollowUps,
  listFollowUpsQuery,
  sendFollowUp,
  sendFollowUpBody,
} from './followup.service';
import { verifySignature, verifyTokenMatches, whatsappConfigured } from './followup.whatsapp';

/** Owner dashboard messaging. Tenant-scoped; Super Admins have no membership and cannot reach it. */
export function createFollowUpRouter() {
  const router = Router();
  const access = [requireAuth, requireBusinessAccess(findMembership)];
  const root = '/businesses/:businessId';

  router.get(`${root}/followups/config`, ...access, (_req, res) => {
    res.json({ data: followUpConfig() });
  });
  router.get(`${root}/followups`, ...access, async (req, res) => {
    res.json(await listFollowUps(req.tenant!.businessId, listFollowUpsQuery.parse(req.query)));
  });
  router.post(`${root}/contacts/:contactId/followups`, ...access, async (req, res) => {
    assertBusinessPermission(req.tenant!.role, 'contacts:manage');
    const contactId = typeof req.params['contactId'] === 'string' ? req.params['contactId'] : '';
    const result = await sendFollowUp(
      req.tenant!.businessId,
      contactId,
      req.auth!.userId,
      sendFollowUpBody.parse(req.body),
    );
    res.status(201).json(result);
  });
  return router;
}

/** Meta webhook: GET handshake and signed POST for statuses and replies. Mounted before JSON parsing. */
export function createWhatsAppWebhook() {
  const router = Router();
  const path = '/api/v1/webhooks/whatsapp';
  router.get(path, (req, res) => {
    if (
      whatsappConfigured() &&
      req.query['hub.mode'] === 'subscribe' &&
      verifyTokenMatches(req.query['hub.verify_token']) &&
      typeof req.query['hub.challenge'] === 'string'
    )
      return res.status(200).type('text/plain').send(req.query['hub.challenge']);
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Verification failed' } });
  });
  router.post(path, raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    const body: unknown = req.body;
    if (!whatsappConfigured())
      throw new AppError(404, 'NOT_FOUND', 'WhatsApp webhook is not enabled');
    if (!Buffer.isBuffer(body)) throw new AppError(400, 'INVALID_WEBHOOK', 'Expected JSON');
    verifySignature(body, req.get('x-hub-signature-256'));
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw new AppError(400, 'INVALID_WEBHOOK', 'Invalid webhook JSON');
    }
    await handleWhatsAppWebhook(payload);
    res.status(200).json({ data: { received: true } });
  });
  return router;
}
