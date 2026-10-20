import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, urlencoded } from 'express';
import { Schema, model, Types, type PipelineStage } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors';
import { type ContactDoc } from '../contacts/contact.model';
import { CampaignRecipient } from './campaign.model';

// No legacy contact is opted in. Consent is bound to the exact tenant/contact/address.
export const MarketingConsent = model(
  'MarketingConsent',
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, required: true },
      contactId: { type: Schema.Types.ObjectId, required: true },
      email: { type: String, required: true },
      state: { type: String, enum: ['granted', 'revoked'], required: true },
      evidence: { type: String, required: true },
      actorUserId: { type: Schema.Types.ObjectId, required: true },
      at: { type: Date, required: true },
    },
    { collection: 'marketing_email_consent' },
  ).index({ businessId: 1, contactId: 1 }, { unique: true }),
);
export const MarketingSuppression = model(
  'MarketingSuppression',
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, required: true },
      email: { type: String, required: true },
      reason: { type: String, required: true },
      at: { type: Date, required: true },
    },
    { collection: 'marketing_email_suppressions' },
  ).index({ businessId: 1, email: 1 }, { unique: true }),
);

export async function suppressMarketing(
  businessId: Types.ObjectId,
  email: string,
  reason: string,
  at = new Date(),
) {
  try {
    await MarketingSuppression.updateOne(
      { businessId, email },
      { $setOnInsert: { reason, at } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
}
export async function marketingAllowed(contact: ContactDoc) {
  const email = contact.emailLowercase?.trim().toLowerCase();
  if (!email || !z.email().safeParse(email).success) return false;
  const scope = { businessId: contact.businessId, email };
  if (await MarketingSuppression.exists(scope)) return false;
  // Query receipts too: a signed complaint can precede saving the provider ID on the recipient.
  const adverse = await CampaignRecipient.aggregate<{ _id: Types.ObjectId }>([
    { $match: { ...scope, providerMessageId: { $type: 'string' } } },
    {
      $lookup: {
        from: 'email_delivery_events',
        localField: 'providerMessageId',
        foreignField: 'providerMessageId',
        as: 'events',
      },
    },
    {
      $match: { 'events.type': { $in: ['email.bounced', 'email.complained', 'email.suppressed'] } },
    },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);
  if (adverse.length) {
    await suppressMarketing(contact.businessId, email, 'provider_suppression');
    return false;
  }
  return Boolean(
    await MarketingConsent.exists({ ...scope, contactId: contact._id, state: 'granted' }),
  );
}
export async function applyMarketingReceipt(providerMessageId: string, type: string) {
  if (!['email.bounced', 'email.complained', 'email.suppressed'].includes(type)) return;
  const r = await CampaignRecipient.findOne({ providerMessageId }).lean();
  if (r?.email) await suppressMarketing(r.businessId, r.email, type);
}

const mac = (payload: string) => {
  if (env.NODE_ENV === 'production' && !env.MARKETING_UNSUBSCRIBE_SECRET)
    throw new AppError(
      503,
      'MARKETING_NOT_CONFIGURED',
      'Configure the permanent marketing unsubscribe secret',
    );
  return createHmac(
    'sha256',
    `${env.MARKETING_UNSUBSCRIBE_SECRET ?? env.JWT_ACCESS_SECRET}:campaign-unsubscribe:v1`,
  )
    .update(payload)
    .digest('hex');
};
export function unsubscribeToken(
  contact: Pick<ContactDoc, '_id' | 'businessId' | 'emailLowercase'>,
) {
  const payload = Buffer.from(
    JSON.stringify([String(contact.businessId), String(contact._id), contact.emailLowercase]),
  ).toString('base64url');
  return `${payload}.${mac(payload)}`;
}
export function unsubscribeUrl(contact: Pick<ContactDoc, '_id' | 'businessId' | 'emailLowercase'>) {
  return `${env.PUBLIC_APP_BASE_URL.replace(/\/+$/, '')}/api/v1/public/campaign-unsubscribe/${unsubscribeToken(contact)}`;
}
export function createMarketingPublicRouter() {
  const router = Router();
  const path = '/api/v1/public/campaign-unsubscribe/:token';
  // GET renders a confirmation so mail scanners cannot unsubscribe on link inspection.
  router.get(path, (req, res) => {
    parseUnsubscribe(req.params['token']);
    res
      .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      .redirect(
        303,
        `${env.PUBLIC_APP_BASE_URL}/email-preferences#token=${encodeURIComponent(String(req.params['token']))}`,
      );
  });
  // RFC 8058 POST is token-authenticated, never cookie-authenticated and intentionally outside CSRF.
  router.post(path, urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    const [businessId, contactId, email] = parseUnsubscribe(req.params['token']);
    await suppressMarketing(new Types.ObjectId(businessId), email, 'customer_unsubscribe');
    await MarketingConsent.updateOne(
      { businessId, contactId, email },
      { $set: { state: 'revoked', at: new Date() } },
    );
    res
      .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      .json({ data: { unsubscribed: true } });
  });
  return router;
}
function parseUnsubscribe(raw: unknown): [string, string, string] {
  const token = z.string().max(1000).parse(raw),
    [payload, signature, ...extra] = token.split('.');
  const fail = () => {
    throw new AppError(404, 'UNSUBSCRIBE_UNAVAILABLE', 'Unsubscribe link unavailable');
  };
  if (!payload || !signature || extra.length) return fail();
  const actual = Buffer.from(signature),
    expected = Buffer.from(mac(payload));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail();
  try {
    return z
      .tuple([z.string().regex(/^[a-f\d]{24}$/), z.string().regex(/^[a-f\d]{24}$/), z.email()])
      .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    return fail();
  }
}

export function marketingAudienceStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: MarketingConsent.collection.name,
        let: { cid: '$_id', bid: '$businessId', email: '$emailLowercase' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$contactId', '$$cid'] },
                  { $eq: ['$businessId', '$$bid'] },
                  { $eq: ['$email', '$$email'] },
                  { $eq: ['$state', 'granted'] },
                ],
              },
            },
          },
        ],
        as: 'marketingConsent',
      },
    },
    { $match: { 'marketingConsent.0': { $exists: true } } },
    {
      $lookup: {
        from: MarketingSuppression.collection.name,
        let: { bid: '$businessId', email: '$emailLowercase' },
        pipeline: [
          {
            $match: {
              $expr: { $and: [{ $eq: ['$businessId', '$$bid'] }, { $eq: ['$email', '$$email'] }] },
            },
          },
        ],
        as: 'suppression',
      },
    },
    { $match: { 'suppression.0': { $exists: false } } },
  ];
}
