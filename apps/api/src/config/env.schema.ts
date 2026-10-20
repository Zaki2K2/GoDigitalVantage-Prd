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

const optionalSecret = (minimum: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(minimum).optional());
const sender = z
  .string()
  .trim()
  .max(254)
  .refine((v) => {
    if (/[\r\n]/.test(v)) return false;
    const match = v.match(/^(?:[^<>]+<([^<>]+)>|([^<>]+))$/);
    return !!match && z.email().safeParse((match[1] ?? match[2])!.trim()).success;
  }, 'Use an email address or Display Name <email>');
export const envSchema = z
  .object({
    EMAIL_PROVIDER: z.literal('resend').default('resend'),
    EMAIL_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    EMAIL_TEST_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    RESEND_TEST_EMAIL: z.preprocess(
      (v) => (typeof v === 'string' ? (v.trim() ? v.trim().toLowerCase() : undefined) : v),
      z.email().optional(),
    ),
    RESEND_TEST_FROM_EMAIL: sender.default('GoDigitalVantage <onboarding@resend.dev>'),
    RESEND_FROM_EMAIL: sender.default('GoDigitalVantage <notifications@mail.godigitalvantage.com>'),
    RESEND_REWARDS_FROM_EMAIL: sender.default(
      'GoDigitalVantage Rewards <rewards@mail.godigitalvantage.com>',
    ),
    RESEND_VERIFY_FROM_EMAIL: sender.default(
      'GoDigitalVantage Verification <verify@mail.godigitalvantage.com>',
    ),
    RESEND_SECURITY_FROM_EMAIL: sender.default(
      'GoDigitalVantage Security <security@mail.godigitalvantage.com>',
    ),
    RESEND_API_KEY: optionalSecret(1),
    INSTANT_REWARDS_TOKEN_SECRET: optionalSecret(32),
    RESEND_WEBHOOK_SECRET: optionalSecret(16),
    MARKETING_UNSUBSCRIBE_SECRET: optionalSecret(32),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PERFORMANCE_LOGGING: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
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
