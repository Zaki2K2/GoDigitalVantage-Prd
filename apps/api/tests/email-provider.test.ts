import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { env } from '../src/config/env';
import { envSchema } from '../src/config/env.schema';
import { sendResendEmail, emailSender } from '../src/modules/email/email.service';
import { renderEmail, type EmailTemplate } from '../src/modules/email/email.templates';
const original = { ...env };
const domain = (status = 'verified', sending = 'enabled') =>
  new Response(
    JSON.stringify({
      data: [{ id: 'd', name: 'mail.godigitalvantage.com', status, capabilities: { sending } }],
    }),
    { status: 200 },
  );
const message = () => ({
  ...renderEmail({ kind: 'notification', title: 'Hello', message: 'Message' }),
  to: 'recipient@example.com',
  idempotencyKey: 'stable-key',
  operationStartedAt: new Date(),
});
beforeEach(() => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_TEST_MODE = false;
  env.RESEND_API_KEY = 'test-only';
  env.RESEND_WEBHOOK_SECRET = 'test-webhook-secret';
});
afterEach(() => {
  Object.assign(env, original);
  vi.unstubAllGlobals();
});
describe('shared email provider', () => {
  it('passes one-click unsubscribe headers in the actual provider payload', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(domain())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'promotional-message' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetcher);
    await sendResendEmail({
      ...message(),
      unsubscribeUrl: 'https://example.com/api/v1/public/campaign-unsubscribe/signed',
    });
    const payload = JSON.parse(fetcher.mock.calls[1]![1].body as string);
    expect(payload.headers).toEqual({
      'List-Unsubscribe': '<https://example.com/api/v1/public/campaign-unsubscribe/signed>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
  it('defaults disabled, parses false strictly, allows blank secrets, rejects invalid sender/header injection', () => {
    const config = {
      MONGODB_URI: 'mongodb://localhost/gdv_test',
      CORS_ORIGIN: 'http://localhost:4200',
      PUBLIC_APP_BASE_URL: 'http://localhost:4200',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
    };
    expect(envSchema.parse(config).EMAIL_ENABLED).toBe(false);
    expect(
      envSchema.parse({
        ...config,
        EMAIL_ENABLED: 'false',
        RESEND_API_KEY: '',
        RESEND_WEBHOOK_SECRET: '',
      }).RESEND_API_KEY,
    ).toBeUndefined();
    expect(envSchema.parse({ ...config, EMAIL_ENABLED: 'true' }).EMAIL_ENABLED).toBe(true);
    expect(envSchema.safeParse({ ...config, EMAIL_ENABLED: 'yes' }).success).toBe(false);
    expect(
      envSchema.safeParse({
        ...config,
        RESEND_FROM_EMAIL: 'A <a@example.com>\r\nBcc: x@example.com',
      }).success,
    ).toBe(false);
  });
  it('never makes network calls while disabled or missing required secrets', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    env.EMAIL_ENABLED = false;
    await expect(sendResendEmail(message())).rejects.toMatchObject({ code: 'EMAIL_DISABLED' });
    env.EMAIL_ENABLED = true;
    env.RESEND_WEBHOOK_SECRET = undefined;
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_NOT_CONFIGURED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('maps template purposes to configured senders and rejects the previous domain', () => {
    expect(emailSender('reward')).toBe(env.RESEND_REWARDS_FROM_EMAIL);
    expect(emailSender('claim-confirmation')).toBe(env.RESEND_REWARDS_FROM_EMAIL);
    expect(emailSender('otp')).toBe(env.RESEND_VERIFY_FROM_EMAIL);
    expect(emailSender('verification')).toBe(env.RESEND_VERIFY_FROM_EMAIL);
    expect(emailSender('password-reset')).toBe(env.RESEND_SECURITY_FROM_EMAIL);
    expect(emailSender('notification')).toBe(env.RESEND_FROM_EMAIL);
    env.RESEND_FROM_EMAIL = 'Bad <notifications@old.example>';
    expect(() => emailSender('notification')).toThrow('approved sending domain');
  });
  for (const [status, sending] of [
    ['not_started', 'enabled'],
    ['failed', 'enabled'],
    ['verified', 'disabled'],
  ])
    it(`blocks ${status}/${sending} domain`, async () => {
      const fetcher = vi.fn().mockResolvedValue(domain(status, sending));
      vi.stubGlobal('fetch', fetcher);
      await expect(sendResendEmail(message())).rejects.toMatchObject({
        code: 'EMAIL_DOMAIN_UNVERIFIED',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  it('fails closed on domain lookup error without exposing provider response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('secret-detail', { status: 403 })),
    );
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_DOMAIN_CHECK_FAILED',
    });
  });
  it('finds a verified domain on a later page and preserves retry payload/idempotency', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith('/emails')
        ? new Response('{"id":"accepted"}', { status: 200 })
        : url.includes('after=')
          ? domain()
          : new Response(
              JSON.stringify({
                has_more: true,
                data: [{ id: 'previous', name: 'elsewhere.example', status: 'verified' }],
              }),
              { status: 200 },
            ),
    );
    vi.stubGlobal('fetch', fetcher);
    const email = message();
    await sendResendEmail(email);
    await sendResendEmail(email);
    const calls = fetcher.mock.calls.filter((c) => c[0].endsWith('/emails'));
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].body).toBe(calls[1]![1].body);
    expect(calls[0]![1].headers['Idempotency-Key']).toBe('stable-key');
    expect(JSON.parse(calls[0]![1].body).from).toBe(env.RESEND_FROM_EMAIL);
  });
  it('rejects stale operations and requires HTTPS in production', async () => {
    await expect(
      sendResendEmail({ ...message(), operationStartedAt: new Date(Date.now() - 21 * 3600000) }),
    ).rejects.toMatchObject({ code: 'EMAIL_RECONCILIATION_REQUIRED' });
    env.NODE_ENV = 'production';
    env.PUBLIC_APP_BASE_URL = 'http://example.com';
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_NOT_CONFIGURED',
    });
  });
  it('reports payload conflicts and uncertain submission without provider details', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(domain())
      .mockResolvedValueOnce(new Response('provider-secret', { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_IDEMPOTENCY_CONFLICT',
    });
    fetcher
      .mockResolvedValueOnce(domain())
      .mockRejectedValueOnce(new Error('private-network-details'));
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_SEND_UNCERTAIN',
    });
  });
  it('renders all six escaped templates without exposing support mailbox or accepting foreign reset links', () => {
    const link = {
      title: '<Reward>',
      summary: '<Summary>',
      url: `${env.PUBLIC_APP_BASE_URL}/instant-reward#token=secret`,
      expiresAt: new Date(),
    };
    const cases: EmailTemplate[] = [
      { kind: 'reward', ...link },
      { kind: 'verification', ...link },
      { kind: 'password-reset', ...link },
      { kind: 'otp', code: '<123456>', expiresAt: new Date() },
      { kind: 'claim-confirmation', title: '<Reward>', receiptId: '<receipt>' },
      { kind: 'notification', title: '<Title>', message: '<Body>' },
    ];
    for (const item of cases) {
      const rendered = renderEmail(item);
      expect(rendered.html).not.toContain('<Reward>');
      expect(rendered.html).not.toContain('<123456>');
      expect(rendered.text).toBeTruthy();
      expect(rendered.html).not.toContain('support@godigitalvantage.com');
    }
    expect(() =>
      renderEmail({ kind: 'password-reset', ...link, url: 'https://evil.example/reset' }),
    ).toThrow('secure application link');
  });
  it('sends only to the normalized test account using the configured onboarding sender without domain lookup', async () => {
    env.EMAIL_TEST_MODE = true;
    env.RESEND_TEST_EMAIL = ' Owner@Example.com ';
    env.RESEND_TEST_FROM_EMAIL = 'Test Brand <onboarding@resend.dev>';
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"id":"test-message"}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    expect(
      await sendResendEmail({ ...message(), to: ' OWNER@example.com ', kind: 'reward' }),
    ).toEqual({ id: 'test-message' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.resend.com/emails');
    const body = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(body.from).toBe('Test Brand <onboarding@resend.dev>');
    expect(body.to).toEqual(['owner@example.com']);
  });
  it('blocks every other recipient before any provider call without redirecting mail', async () => {
    env.EMAIL_TEST_MODE = true;
    env.RESEND_TEST_EMAIL = 'owner@example.com';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const to of [
      'other@example.com',
      'owner+alias@example.com',
      'owner@example.com.evil',
      'owner@example.com,other@example.com',
    ])
      await expect(sendResendEmail({ ...message(), to })).rejects.toMatchObject({
        code: 'EMAIL_TEST_RECIPIENT_BLOCKED',
      });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed on missing test account, unapproved test sender, or disabled master switch', async () => {
    env.EMAIL_TEST_MODE = true;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    env.RESEND_TEST_EMAIL = undefined;
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_TEST_NOT_CONFIGURED',
    });
    env.RESEND_TEST_EMAIL = 'recipient@example.com';
    env.RESEND_TEST_FROM_EMAIL = 'Other <other@resend.dev>';
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_SENDER_INVALID',
    });
    env.EMAIL_ENABLED = false;
    await expect(sendResendEmail(message())).rejects.toMatchObject({ code: 'EMAIL_DISABLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never allows the onboarding sender through the production sender policy', async () => {
    env.EMAIL_TEST_MODE = false;
    env.RESEND_FROM_EMAIL = 'onboarding@resend.dev';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(sendResendEmail(message())).rejects.toMatchObject({
      code: 'EMAIL_SENDER_INVALID',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('strictly parses test flags and normalizes the single optional account email', () => {
    const config = {
      MONGODB_URI: 'mongodb://localhost/gdv_test',
      CORS_ORIGIN: 'http://localhost:4200',
      PUBLIC_APP_BASE_URL: 'http://localhost:4200',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
    };
    expect(envSchema.parse(config).EMAIL_TEST_MODE).toBe(false);
    expect(
      envSchema.parse({ ...config, EMAIL_TEST_MODE: 'false', RESEND_TEST_EMAIL: '' })
        .RESEND_TEST_EMAIL,
    ).toBeUndefined();
    const result = envSchema.parse({
      ...config,
      EMAIL_TEST_MODE: 'true',
      RESEND_TEST_EMAIL: ' Owner@Example.com ',
    });
    expect(result.EMAIL_TEST_MODE).toBe(true);
    expect(result.RESEND_TEST_EMAIL).toBe('owner@example.com');
    expect(envSchema.safeParse({ ...config, EMAIL_TEST_MODE: 'yes' }).success).toBe(false);
    expect(envSchema.safeParse({ ...config, RESEND_TEST_EMAIL: 'not-an-email' }).success).toBe(
      false,
    );
  });
});
