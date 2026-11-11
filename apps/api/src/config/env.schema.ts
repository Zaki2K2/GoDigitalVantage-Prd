import { z } from 'zod';
import { createHash } from 'node:crypto';

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
    // Development must never inherit the production sending credentials.
    RESEND_DEV_API_KEY: optionalSecret(1),
    RESEND_DEV_WEBHOOK_SECRET: optionalSecret(16),
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
    CRON_SECRET: optionalSecret(32),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
    PERFORMANCE_LOGGING: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    PORT: z.coerce.number().int().positive().default(3000),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\/[^\s]+$/),
    CORS_ORIGIN: z
      .string()
      .min(1)
      .refine(
        (value) =>
          value.split(',').every((origin) => {
            try {
              const url = new URL(origin.trim());
              return (
                ['http:', 'https:'].includes(url.protocol) &&
                !url.username &&
                !url.password &&
                url.pathname === '/' &&
                !url.search &&
                !url.hash
              );
            } catch {
              return false;
            }
          }),
        'Use explicit HTTP(S) origins',
      ),
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
      v.NODE_ENV !== 'production' ||
      (v.VERCEL_ENV !== undefined && v.VERCEL_ENV !== 'production') ||
      v.WHATSAPP_GRAPH_BASE_URL === 'https://graph.facebook.com',
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
  .superRefine((value, ctx) => {
    const issue = (name: string) =>
      ctx.addIssue({ code: 'custom', path: [name], message: 'Unsafe or incomplete configuration' });
    if (value.VERCEL_ENV === 'production' && value.NODE_ENV !== 'production') issue('NODE_ENV');
    const preview = value.VERCEL_ENV === 'preview' || value.VERCEL_ENV === 'development';
    if (value.WHATSAPP_ENABLED && (value.NODE_ENV !== 'production' || preview)) {
      const endpoint = URL.canParse(value.WHATSAPP_GRAPH_BASE_URL)
        ? new URL(value.WHATSAPP_GRAPH_BASE_URL)
        : undefined;
      if (
        !endpoint ||
        !['http:', 'https:'].includes(endpoint.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        issue('WHATSAPP_GRAPH_BASE_URL');
    }
    const secrets = {
      JWT_ACCESS_SECRET: value.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: value.JWT_REFRESH_SECRET,
      INSTANT_REWARDS_TOKEN_SECRET: value.INSTANT_REWARDS_TOKEN_SECRET,
      MARKETING_UNSUBSCRIBE_SECRET: value.MARKETING_UNSUBSCRIBE_SECRET,
      CRON_SECRET: value.CRON_SECRET,
    };
    const seen = new Map<string, string>();
    for (const [name, secret] of Object.entries(secrets)) {
      if (!secret) continue;
      if (
        value.NODE_ENV !== 'test' &&
        (/change[-_ ]?me|replace[-_ ]?with|<[^>]+>|placeholder/i.test(secret) ||
          new Set(secret).size < 8)
      )
        issue(name);
      const previous = seen.get(secret);
      if (previous) {
        issue(previous);
        issue(name);
      }
      seen.set(secret, name);
    }
    for (const name of ['RESEND_WEBHOOK_SECRET', 'RESEND_DEV_WEBHOOK_SECRET'] as const) {
      const secret = value[name];
      // This credential appeared in a tracked example. Reject it without storing its value.
      if (
        secret &&
        createHash('sha256').update(secret).digest('hex') ===
          '05c6ea2ba65490d54bcaaba69cf434d44fd51b49b0603e70c22f6985cf79da9f'
      )
        issue(name);
    }
    if (value.RESEND_DEV_API_KEY && value.RESEND_DEV_API_KEY === value.RESEND_API_KEY)
      issue('RESEND_DEV_API_KEY');
    if (
      value.RESEND_DEV_WEBHOOK_SECRET &&
      value.RESEND_DEV_WEBHOOK_SECRET === value.RESEND_WEBHOOK_SECRET
    )
      issue('RESEND_DEV_WEBHOOK_SECRET');
    if (value.NODE_ENV === 'production') {
      if (
        !value.MONGODB_URI.startsWith('mongodb://') &&
        !value.MONGODB_URI.startsWith('mongodb+srv://')
      )
        issue('MONGODB_URI');
      if (!(value.PUBLIC_APP_BASE_URL ?? value.PUBLIC_BASE_URL)?.startsWith('https://'))
        issue('PUBLIC_APP_BASE_URL');
      if (value.RATE_LIMIT_STORE !== 'mongo') issue('RATE_LIMIT_STORE');
    }
    if (value.EMAIL_ENABLED && value.NODE_ENV !== 'test') {
      if ((value.NODE_ENV === 'development' || preview) && !value.EMAIL_TEST_MODE)
        issue('EMAIL_TEST_MODE');
      const development = value.NODE_ENV === 'development' || preview;
      if (!(development ? value.RESEND_DEV_API_KEY : value.RESEND_API_KEY))
        issue(development ? 'RESEND_DEV_API_KEY' : 'RESEND_API_KEY');
      if (!(development ? value.RESEND_DEV_WEBHOOK_SECRET : value.RESEND_WEBHOOK_SECRET))
        issue(development ? 'RESEND_DEV_WEBHOOK_SECRET' : 'RESEND_WEBHOOK_SECRET');
      if (!value.INSTANT_REWARDS_TOKEN_SECRET) issue('INSTANT_REWARDS_TOKEN_SECRET');
      if (value.EMAIL_TEST_MODE && !value.RESEND_TEST_EMAIL) issue('RESEND_TEST_EMAIL');
      if (value.NODE_ENV === 'production' && !value.MARKETING_UNSUBSCRIBE_SECRET)
        issue('MARKETING_UNSUBSCRIBE_SECRET');
    }
    if (value.NODE_ENV === 'production' && value.CRON_SECRET && !value.MARKETING_UNSUBSCRIBE_SECRET)
      issue('MARKETING_UNSUBSCRIBE_SECRET');
  })
  .transform((value) => ({
    ...value,
    RESEND_API_KEY:
      value.NODE_ENV === 'development' || (value.VERCEL_ENV && value.VERCEL_ENV !== 'production')
        ? value.RESEND_DEV_API_KEY
        : value.RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET:
      value.NODE_ENV === 'development' || (value.VERCEL_ENV && value.VERCEL_ENV !== 'production')
        ? value.RESEND_DEV_WEBHOOK_SECRET
        : value.RESEND_WEBHOOK_SECRET,
    PUBLIC_APP_BASE_URL: (value.PUBLIC_APP_BASE_URL ?? value.PUBLIC_BASE_URL)!,
  }));
