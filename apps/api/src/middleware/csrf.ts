import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { CSRF_COOKIE, CSRF_HEADER } from '../modules/auth/cookies';
import { AppError } from '../shared/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Double-submit cookie check for every state-changing request. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie: unknown = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (typeof cookie !== 'string' || !header || !equal(cookie, header)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Invalid or missing CSRF token'));
  }
  next();
};
