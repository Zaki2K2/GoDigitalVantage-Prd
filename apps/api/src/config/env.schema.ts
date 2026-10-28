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
    // WhatsApp Cloud API (Meta). Free test credentials work; nothing sends unless a user clicks Send.
    WHATSAPP_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    WHATSAPP_ACCESS_TOKEN: optionalSecret(1),
    WHATSAPP_PHONE_NUMBER_ID: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .regex(/^\d{5,20}$/)
        .optional(),
    ),
    WHATSAPP_APP_SECRET: optionalSecret(8),
    WHATSAPP_VERIFY_TOKEN: optionalSecret(8),
    // Override only for local mocks; production must use Meta's endpoint.
    WHATSAPP_GRAPH_BASE_URL: z
      .url()
      .transform((v) => v.replace(/\/+$/, ''))
      .default('https://graph.facebook.com'),
    WHATSAPP_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default('v21.0'),
    WHATSAPP_TEMPLATE_NAME: z
      .string()
      .regex(/^[a-z0-9_]{1,512}$/)
      .default('hello_world'),
    WHATSAPP_TEMPLATE_LANGUAGE: z
      .string()
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/)
      .default('en_US'),
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
  .refine(
    (v) =>
      v.NODE_ENV !== 'production' || v.WHATSAPP_GRAPH_BASE_URL === 'https://graph.facebook.com',
    {
      message: 'WHATSAPP_GRAPH_BASE_URL may only be overridden outside production',
      path: ['WHATSAPP_GRAPH_BASE_URL'],
    },
  )
  .refine(
    (v) =>
      !v.WHATSAPP_ENABLED ||
      (v.WHATSAPP_ACCESS_TOKEN &&
        v.WHATSAPP_PHONE_NUMBER_ID &&
        v.WHATSAPP_APP_SECRET &&
        v.WHATSAPP_VERIFY_TOKEN),
    {
      message:
        'WHATSAPP_ENABLED needs WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN',
      path: ['WHATSAPP_ENABLED'],
    },
  )
  .refine((value) => value.PUBLIC_APP_BASE_URL || value.PUBLIC_BASE_URL, {
    message: 'Set PUBLIC_APP_BASE_URL (or legacy PUBLIC_BASE_URL)',
    path: ['PUBLIC_APP_BASE_URL'],
  })
  .transform((value) => ({
    ...value,
    PUBLIC_APP_BASE_URL: (value.PUBLIC_APP_BASE_URL ?? value.PUBLIC_BASE_URL)!,
  }));
