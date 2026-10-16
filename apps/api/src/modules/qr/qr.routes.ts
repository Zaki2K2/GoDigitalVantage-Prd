import { Router } from 'express';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { notFound } from '../../shared/errors';
import { Business } from '../businesses/business.model';
import { findMembership } from '../businesses/business.service';
import { hasPublished } from '../questionnaires/questionnaire.service';

/**
 * The QR encodes only the permanent public URL `<PUBLIC_APP_BASE_URL>/r/<slug>`. The slug is fixed at
 * business creation and never changes, so printed codes keep working after any questionnaire edit.
 */
export function publicUrlFor(slug: string): string {
  return `${env.PUBLIC_APP_BASE_URL}/r/${slug}`;
}

export function createQrRouter() {
  const router = Router();
  const access = [requireAuth, requireBusinessAccess(findMembership)];

  async function slugOf(businessId: string): Promise<string> {
    const b = await Business.findById(businessId, { slug: 1 }).lean();
    if (!b) throw notFound('Business not found');
    return b.slug;
  }

  router.get('/businesses/:businessId/qr', ...access, async (req, res) => {
    const { businessId } = req.tenant!;
    const slug = await slugOf(businessId);
    res.json({
      data: { slug, publicUrl: publicUrlFor(slug), published: await hasPublished(businessId) },
    });
  });

  router.get('/businesses/:businessId/qr.svg', ...access, async (req, res) => {
    const slug = await slugOf(req.tenant!.businessId);
    const svg = await QRCode.toString(publicUrlFor(slug), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 1024,
    });
    if (req.query['download'] === '1') {
      res.attachment(`${slug}-qr.svg`);
    }
    res.type('image/svg+xml').set('Cache-Control', 'private, no-cache').send(svg);
  });

  router.get('/businesses/:businessId/qr.png', ...access, async (req, res) => {
    const slug = await slugOf(req.tenant!.businessId);
    const png = await QRCode.toBuffer(publicUrlFor(slug), {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 1024,
    });
    if (req.query['download'] === '1') {
      res.attachment(`${slug}-qr.png`);
    }
    res.type('image/png').set('Cache-Control', 'private, no-cache').send(png);
  });

  return router;
}
