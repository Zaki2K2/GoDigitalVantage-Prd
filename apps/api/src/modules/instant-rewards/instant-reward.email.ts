import { renderEmail } from '../email/email.templates';
import { sendResendEmail, type EmailMessage } from '../email/email.service';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors';
export type RewardEmail = EmailMessage;
export interface RewardMailer {
  send(email: RewardEmail): Promise<{ id: string }>;
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function deriveToken(nonce: string, purpose: 'claim' | 'verify', requestId: string): string {
  if (!env.INSTANT_REWARDS_TOKEN_SECRET)
    throw new AppError(
      503,
      'EMAIL_NOT_CONFIGURED',
      'Instant Rewards email configuration is incomplete',
    );
  return createHmac('sha256', env.INSTANT_REWARDS_TOKEN_SECRET)
    .update(`instant-rewards:${purpose}:${requestId}:${nonce}`)
    .digest('base64url');
}
export function rewardEmail(
  to: string,
  title: string,
  summary: string,
  expiresAt: Date,
  token: string,
  verification: boolean,
  key: string,
  operationStartedAt = new Date(),
): RewardEmail {
  const url = `${env.PUBLIC_APP_BASE_URL}/instant-reward#${verification ? 'verify' : 'token'}=${token}`;
  return {
    ...renderEmail(
      verification
        ? {
            kind: 'verification',
            title,
            summary,
            url,
            expiresAt,
            ctaLabel: 'Verify reward ownership',
          }
        : { kind: 'reward', title, summary, url, expiresAt },
    ),
    to,
    idempotencyKey: key,
    operationStartedAt,
  };
}
export const resendMailer: RewardMailer = { send: sendResendEmail };
export function verifyEmailWebhook(
  body: Buffer,
  id: string | undefined,
  timestamp: string | undefined,
  signature: string | undefined,
  now = Date.now(),
): void {
  const invalid = () => new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature');
  if (
    !env.RESEND_WEBHOOK_SECRET ||
    !id ||
    id.length > 200 ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !signature ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    throw invalid();
  const secret = Buffer.from(env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', secret).update(`${id}.${timestamp}.`).update(body).digest();
  const valid = signature.split(' ').some((value) => {
    const [version, encoded] = value.split(',');
    if (version !== 'v1' || !encoded) return false;
    const actual = Buffer.from(encoded, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!valid) throw invalid();
}
