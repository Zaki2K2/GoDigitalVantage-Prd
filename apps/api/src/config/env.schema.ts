import { z } from 'zod';

const publicBaseUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !value.includes('?') &&
        !value.includes('#')
      );
    } catch {
      return false;
    }
  }, 'Use an HTTP(S) app URL without credentials, a query string, or a fragment')
  .transform((value) => new URL(value).toString().replace(/\/+$/, ''));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    MONGODB_URI: z.string().min(1),
    CORS_ORIGIN: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    PUBLIC_BASE_URL: publicBaseUrl.optional(),
    PUBLIC_APP_BASE_URL: publicBaseUrl.optional(),
    /** Reverse-proxy hops to trust for client IPs (rate limits, anonymous reward cooldown). 0 = none. */
    /** `mongo` shares rate-limit counters across serverless instances; `memory` for one process. */
    RATE_LIMIT_STORE: z.enum(['memory', 'mongo']).default('memory'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    PUBLIC_SUBMIT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    PUBLIC_SCAN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  })
  .refine((value) => value.PUBLIC_APP_BASE_URL || value.PUBLIC_BASE_URL, {
    message: 'Set PUBLIC_APP_BASE_URL (or legacy PUBLIC_BASE_URL)',
    path: ['PUBLIC_APP_BASE_URL'],
  })
  .transform((value) => ({
    ...value,
    PUBLIC_APP_BASE_URL: (value.PUBLIC_APP_BASE_URL ?? value.PUBLIC_BASE_URL)!,
  }));
