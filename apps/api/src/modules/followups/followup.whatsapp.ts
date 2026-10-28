import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors';

export const whatsappConfigured = () =>
  env.WHATSAPP_ENABLED &&
  !!env.WHATSAPP_ACCESS_TOKEN &&
  !!env.WHATSAPP_PHONE_NUMBER_ID &&
  !!env.WHATSAPP_APP_SECRET &&
  !!env.WHATSAPP_VERIFY_TOKEN;

/** WhatsApp identifies numbers as digits only (no +). */
export const phoneDigits = (e164: string) => e164.replace(/\D/g, '');

export const clickToChatLink = (digits: string, message: string) =>
  `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const verifyTokenMatches = (token: unknown) =>
  !!env.WHATSAPP_VERIFY_TOKEN &&
  typeof token === 'string' &&
  safeEqual(token, env.WHATSAPP_VERIFY_TOKEN);

/** Verifies Meta's `X-Hub-Signature-256: sha256=<hmac of the raw body>` header. */
export function verifySignature(raw: Buffer, header: string | undefined) {
  if (!env.WHATSAPP_APP_SECRET || !header?.startsWith('sha256='))
    throw new AppError(403, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  const expected = createHmac('sha256', env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
  if (!safeEqual(header.slice(7), expected))
    throw new AppError(403, 'INVALID_SIGNATURE', 'Invalid webhook signature');
}

export type SendResult = { ok: true; messageId: string } | { ok: false; errorCode: string };

/** Sends one message through Meta's Graph API. The access token never leaves this function. */
export async function sendWhatsApp(
  toDigits: string,
  content: { text: string } | { template: string },
): Promise<SendResult> {
  const message =
    'text' in content
      ? { type: 'text', text: { body: content.text, preview_url: false } }
      : {
          type: 'template',
          template: {
            name: content.template,
            language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE },
          },
        };
  try {
    const res = await fetch(
      `${env.WHATSAPP_GRAPH_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: toDigits, ...message }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { code?: number };
    };
    const id = json.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, messageId: id };
    return { ok: false, errorCode: `meta_${json.error?.code ?? res.status}` };
  } catch {
    return { ok: false, errorCode: 'network_error' };
  }
}
