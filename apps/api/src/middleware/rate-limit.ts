import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError } from '../shared/errors';

const handler: RequestHandler = (_req, _res, next) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, please try again later'));

/** Failed logins per IP+email; successful logins do not count. In-memory (single instance). */
export function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email: unknown = req.body?.email;
      const id = typeof email === 'string' ? email.trim().toLowerCase() : '';
      return `${ipKeyGenerator(req.ip ?? '')}|${id}`;
    },
    handler,
  });
}

export function createRegisterLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: env.REGISTER_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    handler,
  });
}

/** Anonymous public endpoints: per-IP caps (in-memory, single instance). */
function publicLimiter(limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    handler,
  });
}
export const createPublicSubmitLimiter = () =>
  publicLimiter(env.PUBLIC_SUBMIT_RATE_LIMIT_MAX, 10 * 60 * 1000);
export const createPublicScanLimiter = () =>
  publicLimiter(env.PUBLIC_SCAN_RATE_LIMIT_MAX, 10 * 60 * 1000);

/** Reward code lookups/redemptions: per signed-in user, to make code guessing impractical. */
export function createRewardLookupLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    handler,
  });
}
