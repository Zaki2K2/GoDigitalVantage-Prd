import { afterEach, describe, expect, it, vi } from 'vitest';
import { envSchema } from '../src/config/env.schema';
import { env } from '../src/config/env';
import { sendResendEmail, createResendMailer } from '../src/modules/email/email.service';
import { unsubscribeToken } from '../src/modules/campaigns/campaign.marketing';
import { Types } from 'mongoose';

const original = { ...env };
afterEach(() => {
  Object.assign(env, original);
  env.VERCEL_ENV = original.VERCEL_ENV;
  vi.unstubAllGlobals();
});
const config = {
  MONGODB_URI: 'mongodb://127.0.0.1/gdv_test',
  CORS_ORIGIN: 'http://localhost:4200',
  PUBLIC_APP_BASE_URL: 'http://localhost:4200',
  JWT_ACCESS_SECRET: 'development-access-independent-key-2026',
  JWT_REFRESH_SECRET: 'development-refresh-independent-key-2026',
};
const message = () => ({
  to: 'customer@example.com',
  subject: 'Test',
  text: 'Test',
  html: '<p>Test</p>',
  idempotencyKey: 'isolated-operation',
  operationStartedAt: new Date(),
});

describe('security configuration and delivery boundaries', () => {
  it('treats Vercel previews as non-production even with NODE_ENV=production', async () => {
    const preview = {
      ...config,
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      PUBLIC_APP_BASE_URL: 'https://preview.example.com',
      RATE_LIMIT_STORE: 'mongo',
      RESEND_API_KEY: 'production-only',
    };
    expect(envSchema.parse(preview).RESEND_API_KEY).toBeUndefined();
    expect(envSchema.safeParse({ ...preview, EMAIL_ENABLED: 'true' }).success).toBe(false);
    Object.assign(env, {
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      EMAIL_ENABLED: true,
      EMAIL_TEST_MODE: false,
    });
    const transport = vi.fn();
    await expect(createResendMailer(transport)(message())).rejects.toMatchObject({
      code: 'EMAIL_TEST_MODE_REQUIRED',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it('allows only loopback WhatsApp mocks outside production and validates malformed URLs safely', () => {
    const whatsapp = {
      ...config,
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'test-only',
      WHATSAPP_PHONE_NUMBER_ID: '123456789',
      WHATSAPP_APP_SECRET: 'test-app-secret-2026',
      WHATSAPP_VERIFY_TOKEN: 'test-verify-token-2026',
    };
    for (const WHATSAPP_GRAPH_BASE_URL of [
      'https://graph.facebook.com',
      'not-a-url',
      'https://attacker.example',
    ])
      expect(envSchema.safeParse({ ...whatsapp, WHATSAPP_GRAPH_BASE_URL }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...whatsapp, WHATSAPP_GRAPH_BASE_URL: 'http://127.0.0.1:3198' })
        .success,
    ).toBe(true);
  });
  it('ignores production Resend credentials in development and defaults delivery off', () => {
    const parsed = envSchema.parse({ ...config, RESEND_API_KEY: 'production-only' });
    expect(parsed.EMAIL_ENABLED).toBe(false);
    expect(parsed.RESEND_API_KEY).toBeUndefined();
    expect(
      envSchema.parse({ ...config, RESEND_DEV_API_KEY: 'development-only' }).RESEND_API_KEY,
    ).toBe('development-only');
    expect(
      envSchema.safeParse({ ...config, RESEND_API_KEY: 'same-key', RESEND_DEV_API_KEY: 'same-key' })
        .success,
    ).toBe(false);
  });
  it('fails startup for unrestricted development sending or missing test configuration', () => {
    const enabled = { ...config, EMAIL_ENABLED: 'true' };
    expect(envSchema.safeParse(enabled).success).toBe(false);
    expect(envSchema.safeParse({ ...enabled, EMAIL_TEST_MODE: 'true' }).success).toBe(false);
    expect(
      envSchema.safeParse({
        ...enabled,
        EMAIL_TEST_MODE: 'true',
        RESEND_TEST_EMAIL: 'tester@example.com',
        RESEND_DEV_API_KEY: 'dev-only',
        RESEND_DEV_WEBHOOK_SECRET: 'dev-webhook-independent-2026',
        INSTANT_REWARDS_TOKEN_SECRET: 'dev-rewards-independent-secret-2026',
      }).success,
    ).toBe(true);
  });
  it('rejects example, low-diversity, reused signing secrets and malformed cron secrets', () => {
    for (const JWT_ACCESS_SECRET of [
      'change-me-at-least-32-characters-long',
      '<generate-independent-random-secret>',
      'x'.repeat(64),
    ])
      expect(envSchema.safeParse({ ...config, JWT_ACCESS_SECRET }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...config, JWT_REFRESH_SECRET: config.JWT_ACCESS_SECRET }).success,
    ).toBe(false);
    expect(envSchema.safeParse({ ...config, CRON_SECRET: 'short' }).success).toBe(false);
  });
  it('requires HTTPS, distributed limits, and correct environment on Vercel production', () => {
    expect(envSchema.safeParse({ ...config, VERCEL_ENV: 'production' }).success).toBe(false);
    const production = {
      ...config,
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      PUBLIC_APP_BASE_URL: 'https://app.example.com',
      RATE_LIMIT_STORE: 'mongo',
    };
    expect(envSchema.safeParse(production).success).toBe(true);
    expect(envSchema.safeParse({ ...production, RATE_LIMIT_STORE: 'memory' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...production, CRON_SECRET: 'independent-scheduler-secret-key-2026' })
        .success,
    ).toBe(false);
    expect(envSchema.safeParse({ ...production, EMAIL_ENABLED: 'true' }).success).toBe(false);
  });
  it('rejects invalid database protocols and CORS wildcards/paths', () => {
    expect(envSchema.safeParse({ ...config, MONGODB_URI: 'https://db.example.com' }).success).toBe(
      false,
    );
    for (const CORS_ORIGIN of [
      '*',
      'https://app.example.com/path',
      'https://user:pass@example.com',
      ',',
    ])
      expect(envSchema.safeParse({ ...config, CORS_ORIGIN }).success).toBe(false);
  });
  it('blocks the application mailer in automated tests even with otherwise complete credentials', async () => {
    Object.assign(env, {
      NODE_ENV: 'test',
      EMAIL_ENABLED: true,
      EMAIL_TEST_MODE: false,
      RESEND_API_KEY: 'test-only',
      RESEND_WEBHOOK_SECRET: 'test-webhook-independent-2026',
    });
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_TEST_NETWORK_BLOCKED',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it('blocks customer addresses in development before any injected transport call', async () => {
    Object.assign(env, { NODE_ENV: 'development', EMAIL_ENABLED: true, EMAIL_TEST_MODE: false });
    const transport = vi.fn();
    const send = createResendMailer(transport);
    await expect(send(message())).rejects.toMatchObject({ code: 'EMAIL_TEST_MODE_REQUIRED' });
    env.EMAIL_TEST_MODE = true;
    env.RESEND_TEST_EMAIL = 'tester@example.com';
    await expect(send(message())).rejects.toMatchObject({ code: 'EMAIL_TEST_RECIPIENT_BLOCKED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('never falls back to the access-token secret for unsubscribe links', () => {
    env.MARKETING_UNSUBSCRIBE_SECRET = undefined;
    expect(() =>
      unsubscribeToken({
        businessId: new Types.ObjectId(),
        _id: new Types.ObjectId(),
        emailLowercase: 'customer@example.com',
      }),
    ).toThrow();
  });
});
