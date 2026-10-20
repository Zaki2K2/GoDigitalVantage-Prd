import type { RequestHandler } from 'express';
import { ACCESS_COOKIE } from '../modules/auth/cookies';
import { User } from '../modules/auth/user.model';
import { accessIssuedAt, accessSessionVersion, verifyAccessToken } from '../modules/auth/tokens';
import { unauthorized } from '../shared/errors';
import { timeAuth } from '../shared/perf';

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
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const cookie: unknown = req.cookies?.[ACCESS_COOKIE];
  const userId = verifyAccessToken(typeof cookie === 'string' ? cookie : undefined);
  if (!userId || !/^[a-f\d]{24}$/i.test(userId))
    return next(unauthorized('Authentication required'));
  try {
    const user = await timeAuth(async () =>
      User.findById(userId, { status: 1, sessionsRevokedAt: 1, sessionVersion: 1 }).lean(),
    );
    if (
      !user ||
      user.status !== 'active' ||
      (accessSessionVersion(String(cookie)) ?? 0) !== (user.sessionVersion ?? 0) ||
      (accessSessionVersion(String(cookie)) === null &&
        user.sessionsRevokedAt &&
        accessIssuedAt(String(cookie)) <= user.sessionsRevokedAt.getTime())
    ) {
      return next(unauthorized('Session unavailable'));
    }
    req.auth = { userId: userId.toLowerCase() };
    next();
  } catch (err) {
    next(err);
  }
};
