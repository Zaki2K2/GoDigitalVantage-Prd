import { createHmac } from 'node:crypto';
import { env } from '../../config/env';
import { loadPublished } from '../questionnaires/questionnaire.service';
import { QrEvent } from './qr-event.model';

const WINDOW_MS = 30 * 60 * 1000;
const CRAWLER = /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget/i;

/**
 * Counts one scan per visitor per business per 30 minutes.
 * Privacy: no IP or user agent is stored. The visitor key is an HMAC of both, salted with the
 * UTC date, so it cannot be reversed or linked across days. Unavailable slugs are not counted.
 * Returns true when a new scan was counted.
 */
export async function recordScan(
  slug: string,
  ip: string,
  userAgent: string,
  now = new Date(),
): Promise<boolean> {
  if (CRAWLER.test(userAgent)) return false;
  const { business } = await loadPublished(slug);
  const day = now.toISOString().slice(0, 10);
  const visitorHash = createHmac('sha256', `${env.JWT_ACCESS_SECRET}:qr-visitor:${day}`)
    .update(`${business._id}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 32);
  const windowIndex = Math.floor(now.getTime() / WINDOW_MS);
  const res = await QrEvent.updateOne(
    { businessId: business._id, eventType: 'scan', visitorHash, windowIndex },
    {
      $setOnInsert: { qrId: business.slug, occurredAt: now },
    },
    { upsert: true },
  );
  return res.upsertedCount === 1;
}
