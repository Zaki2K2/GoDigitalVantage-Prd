const domainResponse = () =>
  new Response(
    JSON.stringify({
      data: [
        {
          id: 'domain',
          name: 'mail.godigitalvantage.com',
          status: 'verified',
          capabilities: { sending: 'enabled' },
        },
      ],
    }),
    { status: 200 },
  );
import { afterEach, describe, it, expect, vi } from 'vitest';
import { env } from '../src/config/env';
import {
  resendMailer,
  rewardEmail,
  verifyEmailWebhook,
} from '../src/modules/instant-rewards/instant-reward.email';
const original = {
  RESEND_API_KEY: env.RESEND_API_KEY,
  EMAIL_ENABLED: env.EMAIL_ENABLED,
  RESEND_WEBHOOK_SECRET: env.RESEND_WEBHOOK_SECRET,
};
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, original);
});
describe('Instant Rewards real email adapter contract', () => {
  it('uses authenticated Resend idempotency, correct recipient and escaped fragment links', async () => {
    env.RESEND_API_KEY = 'test-only';
    env.EMAIL_ENABLED = true;
    env.RESEND_WEBHOOK_SECRET = 'test-webhook-secret';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(domainResponse())
      .mockResolvedValue(new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const email = rewardEmail(
      'recipient@example.com',
      '<script>',
      '20% off',
      new Date('2026-12-01T00:00:00Z'),
      'a'.repeat(43),
      false,
      'test/idempotency',
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain('/instant-reward#token=');
    expect(await resendMailer.send(email)).toEqual({ id: 'provider-id' });
    const [url, options] = fetcher.mock.calls[1]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers['Idempotency-Key']).toBe('test/idempotency');
    expect(JSON.parse(options.body).to).toEqual(['recipient@example.com']);
  });
  it('fails closed without configuration and sanitizes provider errors', async () => {
    env.EMAIL_ENABLED = true;
    env.RESEND_WEBHOOK_SECRET = 'test-webhook-secret';
    env.RESEND_API_KEY = undefined;
    const email = rewardEmail(
      'r@example.com',
      'Reward',
      'Summary',
      new Date(),
      'b'.repeat(43),
      false,
      'key',
    );
    await expect(resendMailer.send(email)).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
    env.RESEND_API_KEY = 'test-only';
    env.EMAIL_ENABLED = true;
    env.RESEND_WEBHOOK_SECRET = 'test-webhook-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(domainResponse())
        .mockResolvedValue(new Response('sensitive provider detail', { status: 422 })),
    );
    await expect(resendMailer.send(email)).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(domainResponse())
        .mockResolvedValue(new Response('sensitive provider detail', { status: 503 })),
    );
    await expect(resendMailer.send(email)).rejects.toMatchObject({ code: 'EMAIL_SEND_UNCERTAIN' });
  });
  it('rejects invalid or stale webhook signatures without exposing body data', () => {
    expect(() => verifyEmailWebhook(Buffer.from('{}'), 'id', '1', 'v1,invalid')).toThrow(
      'Invalid webhook signature',
    );
  });
});
