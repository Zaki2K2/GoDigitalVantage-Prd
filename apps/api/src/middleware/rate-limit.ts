import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError } from '../shared/errors';
import { MongoRateLimitStore } from './mongo-rate-limit-store';

/** Shared counters in MongoDB when `RATE_LIMIT_STORE=mongo` (serverless); in-memory otherwise. */
const sharedStore = (name: string) =>
  env.RATE_LIMIT_STORE === 'mongo' ? new MongoRateLimitStore(name) : undefined;

const handler: RequestHandler = (_req, _res, next) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, please try again later'));

/** Failed logins per IP+email; successful logins do not count. In-memory (single instance). */
export function createLoginLimiter() {
  return rateLimit({
    store: sharedStore('login'),
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
    store: sharedStore('register'),
    windowMs: 60 * 60 * 1000,
    limit: env.REGISTER_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    handler,
  });
}

/** Anonymous public endpoints: per-IP caps (in-memory, single instance). */
function publicLimiter(name: string, limit: number, windowMs: number) {
  return rateLimit({
    store: sharedStore(name),
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    handler,
  });
}
export const createPublicSubmitLimiter = () =>
  publicLimiter('public-submit', env.PUBLIC_SUBMIT_RATE_LIMIT_MAX, 10 * 60 * 1000);
export const createPublicScanLimiter = () =>
  publicLimiter('public-scan', env.PUBLIC_SCAN_RATE_LIMIT_MAX, 10 * 60 * 1000);

/** Reward code lookups/redemptions: per signed-in user, to make code guessing impractical. */
export function createRewardLookupLimiter() {
  return rateLimit({
    store: sharedStore('reward-lookup'),
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    handler,
  });
}

export function createInstantRewardLimiter() {
  return rateLimit({
    store: sharedStore('instant-reward'),
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${req.auth!.userId}|${ipKeyGenerator(req.ip ?? '')}`,
    handler,
  });
}

export function createInstantRewardSendLimiter() {
  return rateLimit({
    store: sharedStore('instant-reward-send'),
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth!.userId,
    skip: (req) => req.method === 'GET',
    handler,
  });
}
