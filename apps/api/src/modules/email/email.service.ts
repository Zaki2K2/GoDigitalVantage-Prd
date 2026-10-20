import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors';
import type { EmailKind } from './email.templates';
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  kind?: EmailKind;
  operationStartedAt?: Date;
  unsubscribeUrl?: string;
}
export const SENDING_DOMAIN = 'mail.godigitalvantage.com';
function fail(code: string, message: string): never {
  throw new AppError(503, code, message);
}
export function emailSender(kind: EmailMessage['kind']) {
  if (env.EMAIL_TEST_MODE) {
    const from = env.RESEND_TEST_FROM_EMAIL;
    const address = (from.match(/<([^<>]+)>$/)?.[1] ?? from).trim().toLowerCase();
    if (address !== 'onboarding@resend.dev')
      fail('EMAIL_SENDER_INVALID', 'Configure the approved Resend test sender');
    return from;
  }
  const from =
    kind === 'reward' || kind === 'claim-confirmation'
      ? env.RESEND_REWARDS_FROM_EMAIL
      : kind === 'verification' || kind === 'otp'
        ? env.RESEND_VERIFY_FROM_EMAIL
        : kind === 'password-reset'
          ? env.RESEND_SECURITY_FROM_EMAIL
          : env.RESEND_FROM_EMAIL;
  const address = (from.match(/<([^<>]+)>$/)?.[1] ?? from).trim();
  if (address.split('@')[1]?.toLowerCase() !== SENDING_DOMAIN)
    fail('EMAIL_SENDER_INVALID', 'Configure a sender on the approved sending domain');
  return from;
}
const domains = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      capabilities: z.object({ sending: z.string() }).optional(),
    }),
  ),
  has_more: z.boolean().optional(),
});
export async function sendResendEmail(email: EmailMessage): Promise<{ id: string }> {
  if (email.unsubscribeUrl) {
    const parsed = z.url().safeParse(email.unsubscribeUrl);
    if (
      !parsed.success ||
      /[\r\n<>]/.test(email.unsubscribeUrl) ||
      !['https:', 'http:'].includes(new URL(email.unsubscribeUrl).protocol)
    )
      throw new AppError(422, 'INVALID_EMAIL', 'Invalid unsubscribe URL');
  }
  if (!env.EMAIL_ENABLED) fail('EMAIL_DISABLED', 'Email sending is disabled');
  if (env.EMAIL_TEST_MODE) {
    const allowed = env.RESEND_TEST_EMAIL?.trim().toLowerCase();
    if (!allowed || !z.email().safeParse(allowed).success)
      fail('EMAIL_TEST_NOT_CONFIGURED', 'Configure the Resend account email before testing');
    if (email.to.trim().toLowerCase() !== allowed)
      throw new AppError(
        403,
        'EMAIL_TEST_RECIPIENT_BLOCKED',
        'Test mode permits only the configured Resend account recipient',
      );
  }
  if (!env.RESEND_API_KEY || !env.RESEND_WEBHOOK_SECRET)
    fail('EMAIL_NOT_CONFIGURED', 'Email credentials and webhook signing secret are required');
  if (env.NODE_ENV === 'production' && !env.PUBLIC_APP_BASE_URL.startsWith('https://'))
    fail('EMAIL_NOT_CONFIGURED', 'Configure an HTTPS application origin');
  if (
    !z.email().safeParse(email.to.trim()).success ||
    !email.idempotencyKey ||
    email.idempotencyKey.length > 256
  )
    throw new AppError(422, 'INVALID_EMAIL', 'Invalid recipient or email operation');
  if (
    !email.operationStartedAt ||
    !Number.isFinite(email.operationStartedAt.getTime()) ||
    Date.now() - email.operationStartedAt.getTime() > 20 * 3600000 ||
    email.operationStartedAt.getTime() > Date.now() + 60000
  )
    fail(
      'EMAIL_RECONCILIATION_REQUIRED',
      'Use a new explicit email operation after the retry window',
    );
  const from = emailSender(email.kind);
  const signal = AbortSignal.timeout(8000);
  const auth = { Authorization: `Bearer ${env.RESEND_API_KEY}` };
  if (!env.EMAIL_TEST_MODE) {
    // No cross-instance cache: every send must establish current provider verification.
    let verified = false;
    let after: string | undefined;
    try {
      for (let page = 0; page < 10; page++) {
        const response = await fetch(
          `https://api.resend.com/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
          { headers: auth, signal },
        );
        if (!response.ok) fail('EMAIL_DOMAIN_CHECK_FAILED', 'Unable to verify the sending domain');
        const result = domains.safeParse(await response.json());
        if (!result.success)
          fail('EMAIL_DOMAIN_CHECK_FAILED', 'Unable to verify the sending domain');
        const domain = result.data.data.find((d) => d.name.toLowerCase() === SENDING_DOMAIN);
        if (domain) {
          verified = domain.status === 'verified' && domain.capabilities?.sending === 'enabled';
          break;
        }
        if (!result.data.has_more || !result.data.data.length) break;
        after = result.data.data.at(-1)!.id;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail('EMAIL_DOMAIN_CHECK_FAILED', 'Unable to verify the sending domain');
    }
    if (!verified)
      fail('EMAIL_DOMAIN_UNVERIFIED', 'Sending domain must be verified and enabled in Resend');
  }
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [email.to.trim().toLowerCase()],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.unsubscribeUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${email.unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            }
          : {}),
      }),
      signal,
    });
  } catch {
    fail(
      'EMAIL_SEND_UNCERTAIN',
      'Email acceptance could not be confirmed; retry the same operation',
    );
  }
  if (!response.ok) {
    if (response.status === 409)
      fail('EMAIL_IDEMPOTENCY_CONFLICT', 'The email operation conflicts with an earlier payload');
    fail(
      response.status >= 500 || response.status === 429
        ? 'EMAIL_SEND_UNCERTAIN'
        : 'EMAIL_SEND_FAILED',
      'Email provider did not accept this operation',
    );
  }
  const data = z
    .object({ id: z.string().min(1) })
    .safeParse(await response.json().catch(() => null));
  if (!data.success) fail('EMAIL_SEND_UNCERTAIN', 'Email acceptance could not be confirmed');
  return data.data;
}
