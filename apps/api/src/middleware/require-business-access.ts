import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from '../shared/errors';

export type MembershipLookup = (
  userId: string,
  businessId: string,
) => Promise<{ role: string } | null>;

/**
 * Tenant guard for `/businesses/:businessId/*` routes. The business id from the URL is never
 * trusted on its own: access requires a membership for the authenticated user. The lookup is
 * injected so M-BIZ supplies the real membership query; until then no route uses this.
 * Must run after `requireAuth`.
 */
export function requireBusinessAccess(lookup: MembershipLookup): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.auth) throw unauthorized('Authentication required');
      const businessId = req.params['businessId'];
      if (typeof businessId !== 'string' || !/^[a-f\d]{24}$/i.test(businessId)) {
        throw forbidden('No access to this business');
      }
      const membership = await lookup(req.auth.userId, businessId);
      if (!membership) throw forbidden('No access to this business');
      req.tenant = { businessId, role: membership.role };
      next();
    } catch (err) {
      next(err);
    }
  };
}
