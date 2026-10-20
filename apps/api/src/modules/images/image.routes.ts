import express, { Router, type Response } from 'express';
import { requireAuth } from '../../middleware/require-auth';
import { requireBusinessAccess } from '../../middleware/require-business-access';
import { forbidden, notFound } from '../../shared/errors';
import { requireSuperAdmin } from '../admin/admin.auth';
import { idSchema } from '../admin/admin.schemas';
import { Business } from '../businesses/business.model';
import * as businesses from '../businesses/business.service';
import type { ImageOwnerType } from './image.model';
import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  loadImage,
  removeImage,
  saveImage,
} from './image.service';

/** Only declared image types are buffered; any other body type reaches the handler as empty. */
const rawImage = express.raw({ type: [...IMAGE_CONTENT_TYPES], limit: MAX_IMAGE_BYTES });

const PRIVATE = 'private, max-age=86400';
/** Public caching is limited to the customer-facing logo. */
const PUBLIC = 'public, max-age=3600';

async function send(res: Response, type: ImageOwnerType, id: string, cache: string) {
  const image = await loadImage(type, id);
  res.set({ 'Content-Type': image.contentType, 'Cache-Control': cache });
  res.send(image.data);
}

/** Public business logo for customer-facing pages. Unavailable businesses 404 like their form. */
export function createPublicImageRouter() {
  const router = Router();
  router.get('/public/:slug/logo', async (req, res) => {
    const slug = typeof req.params['slug'] === 'string' ? req.params['slug'] : '';
    const business = await Business.findOne(
      {
        slug,
        status: { $ne: 'disabled' },
        adminState: { $in: ['active', null] },
        logoUpdatedAt: { $ne: null },
      },
      { _id: 1 },
    ).lean();
    if (!business) throw notFound('No image');
    await send(res, 'business', business._id.toString(), PUBLIC);
  });
  return router;
}

export function createImageRouter() {
  const router = Router();
  const access = requireBusinessAccess(businesses.findMembership);
  const ownerOnly = (role: string | undefined) => {
    if (role !== 'owner') throw forbidden('Only the owner can change the logo');
  };

  router.get('/users/me/avatar', requireAuth, (req, res) =>
    send(res, 'user', req.auth!.userId, PRIVATE),
  );
  router.put('/users/me/avatar', requireAuth, rawImage, async (req, res) => {
    const at = await saveImage('user', req.auth!.userId, req.body);
    res.json({ data: { avatarUrl: `/api/v1/users/me/avatar?v=${at.getTime()}` } });
  });
  router.delete('/users/me/avatar', requireAuth, async (req, res) => {
    await removeImage('user', req.auth!.userId);
    res.status(204).end();
  });

  router.get('/businesses/:businessId/logo', requireAuth, access, (req, res) =>
    send(res, 'business', req.tenant!.businessId, PRIVATE),
  );
  router.put('/businesses/:businessId/logo', requireAuth, access, rawImage, async (req, res) => {
    ownerOnly(req.tenant!.role);
    const id = req.tenant!.businessId;
    const at = await saveImage('business', id, req.body);
    res.json({ data: { logoUrl: `/api/v1/businesses/${id}/logo?v=${at.getTime()}` } });
  });
  router.delete('/businesses/:businessId/logo', requireAuth, access, async (req, res) => {
    ownerOnly(req.tenant!.role);
    await removeImage('business', req.tenant!.businessId);
    res.status(204).end();
  });

  // Platform admins can view any image (read-only); editing stays with the owner.
  router.get('/admin/users/:id/avatar', requireAuth, requireSuperAdmin, (req, res) =>
    send(res, 'user', idSchema.parse(req.params['id']), PRIVATE),
  );
  router.get('/admin/businesses/:id/logo', requireAuth, requireSuperAdmin, (req, res) =>
    send(res, 'business', idSchema.parse(req.params['id']), PRIVATE),
  );

  return router;
}
