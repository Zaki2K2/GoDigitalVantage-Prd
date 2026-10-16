import type { RequestHandler } from 'express';
import { ACCESS_COOKIE } from '../modules/auth/cookies';
import { verifyAccessToken } from '../modules/auth/tokens';
import { unauthorized } from '../shared/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string };
      tenant?: { businessId: string; role: string };
    }
  }
}

/** Verifies the httpOnly access cookie and attaches `req.auth`. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const cookie: unknown = req.cookies?.[ACCESS_COOKIE];
  const userId = verifyAccessToken(typeof cookie === 'string' ? cookie : undefined);
  if (!userId) return next(unauthorized('Authentication required'));
  req.auth = { userId };
  next();
};
