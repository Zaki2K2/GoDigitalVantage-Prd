import { env } from '../../config/env';
import { AppError } from '../../shared/errors';
export type EmailKind =
  'reward' | 'verification' | 'otp' | 'password-reset' | 'claim-confirmation' | 'notification';
type Link = { title: string; summary: string; url: string; expiresAt: Date; ctaLabel?: string };
export type EmailTemplate =
  | ({ kind: 'reward' | 'verification' | 'password-reset' } & Link)
  | { kind: 'otp'; code: string; expiresAt: Date }
  | { kind: 'claim-confirmation'; title: string; receiptId: string }
  | { kind: 'notification'; title: string; message: string };
const escapeHtml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function renderEmail(input: EmailTemplate) {
  let subject: string;
  let lines: string[];
  let cta: { url: string; label: string } | undefined;
  switch (input.kind) {
    case 'reward':
    case 'verification':
    case 'password-reset': {
      const url = new URL(input.url);
      const base = new URL(env.PUBLIC_APP_BASE_URL);
      if (
        url.origin !== base.origin ||
        url.username ||
        url.password ||
        !['http:', 'https:'].includes(url.protocol) ||
        (env.NODE_ENV === 'production' && url.protocol !== 'https:')
      )
        throw new AppError(422, 'INVALID_EMAIL_LINK', 'Use a secure application link');
      const label =
        input.kind === 'reward'
          ? 'View / Claim Reward'
          : input.kind === 'verification'
            ? (input.ctaLabel ?? 'Verify email')
            : 'Reset password';
      subject =
        input.kind === 'reward'
          ? `Your reward: ${input.title}`
          : input.kind === 'verification'
            ? 'Verify your email'
            : 'Reset your password';
      lines = [input.title, input.summary, `Link expires: ${input.expiresAt.toISOString()}`];
      cta = { url: url.href, label };
      break;
    }
    case 'otp':
      subject = 'Your verification code';
      lines = [
        `Your verification code: ${input.code}`,
        `Expires: ${input.expiresAt.toISOString()}`,
        'Do not share this code.',
      ];
      break;
    case 'claim-confirmation':
      subject = `Reward claimed: ${input.title}`;
      lines = [
        input.title,
        `Claim receipt: ${input.receiptId}`,
        'Your reward claim has been recorded.',
      ];
      break;
    case 'notification':
      subject = input.title;
      lines = [input.message];
      break;
  }
  subject = subject.replace(/[\r\n]/g, ' ').slice(0, 200);
  const footer = 'GoDigitalVantage';
  return {
    kind: input.kind,
    subject,
    text: [...lines, ...(cta ? [`${cta.label}: ${cta.url}`] : []), footer].join('\n'),
    html: `<h1>${escapeHtml(subject)}</h1>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${cta ? `<p><a href="${escapeHtml(cta.url)}">${cta.label}</a></p>` : ''}<p>${footer}</p>`,
  };
}
