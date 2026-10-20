import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Types, type QueryFilter } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { Campaign } from '../campaigns/campaign.model';
import { RewardOrderClaim } from './reward.model';
import { AppError, forbidden, notFound } from '../../shared/errors';
import { escapeRegex, OBJECT_ID, pageMeta } from '../../shared/pagination';
import { lastDays } from '../analytics/dashboard.service';
import { Business } from '../businesses/business.model';
import { Contact, type ContactDoc } from '../contacts/contact.model';
import { contactSearchFilter } from '../contacts/contact.service';
import { Response, type ResponseDoc } from '../responses/response.model';
import {
  Incident,
  Reward,
  RewardAudit,
  RewardQuota,
  RewardRule,
  type IncidentDoc,
  type RewardDoc,
  type RewardRuleDoc,
} from './reward.model';
import {
  listIncidentsQuery,
  listRewardsQuery,
  type RuleInput,
  summaryQuery,
} from './reward.schemas';

const DAY = 24 * 3600 * 1000;
const isDup = (e: unknown) => (e as { code?: number }).code === 11000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(id);

// ---- secrets, codes, tokens --------------------------------------------------------------------

const hmac = (label: string, data: string) =>
  createHmac('sha256', `${env.JWT_ACCESS_SECRET}:rewards:${label}`).update(data).digest('hex');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U

/** `GDV-XXXX-XXXX`: 40 bits from the OS CSPRNG. Lookups are authenticated and rate limited. */
export function newCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i]! % 32];
  return `GDV-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = c.startsWith('GDV') ? c.slice(3) : c;
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(body) ? `GDV-${body.slice(0, 4)}-${body.slice(4)}` : null;
}

/** Stateless customer link token: `<rewardId>.<mac>`. Nothing about it is stored. */
export const signToken = (rewardId: string | Types.ObjectId) =>
  `${rewardId}.${hmac('token', String(rewardId)).slice(0, 32)}`;

export function parseToken(token: string): string | null {
  const [id, mac] = token.split('.');
  if (!id || !mac || !OBJECT_ID.test(id)) return null;
  const want = Buffer.from(hmac('token', id).slice(0, 32));
  const got = Buffer.from(mac);
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}

export interface Client {
  ip: string;
  userAgent: string;
}

export function identityHash(
  businessId: Types.ObjectId,
  contact: ContactDoc | null,
  client: Client,
) {
  const key = contact
    ? contact.phoneE164
      ? `p:${contact.phoneE164}`
      : `e:${contact.emailLowercase}`
    : `a:${client.ip}|${client.userAgent}`;
  return hmac('identity', `${businessId}|${key}`);
}

// ---- audit -------------------------------------------------------------------------------------

async function audit(
  businessId: Types.ObjectId | string,
  action: string,
  ref: {
    actor?: string | null;
    rule?: Types.ObjectId | null;
    reward?: Types.ObjectId | null;
    incident?: Types.ObjectId | null;
    details?: Record<string, unknown>;
  } = {},
) {
  await RewardAudit.create({
    businessId: oid(businessId),
    ruleId: ref.rule ?? null,
    rewardId: ref.reward ?? null,
    incidentId: ref.incident ?? null,
    actorUserId: ref.actor ? oid(ref.actor) : null,
    action,
    details: ref.details ?? {},
    at: new Date(),
  });
}

// ---- DTOs --------------------------------------------------------------------------------------

export type EffectiveStatus = RewardDoc['status'] | 'expired';
export function effectiveStatus(r: Pick<RewardDoc, 'status' | 'expiresAt'>, now = new Date()) {
  const s: EffectiveStatus = r.status;
  return r.status === 'issued' && r.expiresAt && r.expiresAt <= now ? 'expired' : s;
}

const discountOf = (r: RewardDoc) => ({
  type: r.discountType,
  value: r.discountValue,
  currency: r.currency,
  minSpend: r.minSpend,
  maxDiscount: r.maxDiscount,
});

/** What the customer (and the thank-you page) sees. The code is hidden until approved. */
export function customerView(r: RewardDoc, now = new Date()) {
  const status = effectiveStatus(r, now);
  const showCode = status === 'issued' || status === 'redeemed' || status === 'expired';
  return {
    token: signToken(r._id),
    status,
    code: showCode ? r.code : null,
    discount: discountOf(r),
    issuedAt: r.issuedAt,
    expiresAt: r.expiresAt,
    redeemedAt: r.redemption?.at ?? null,
    terms: r.terms,
  };
}

type Brief = { id: string; fullName: string | null; email: string | null; phone: string | null };
const brief = (c: ContactDoc): Brief => ({
  id: String(c._id),
  fullName: c.fullName,
  email: c.emailLowercase,
  phone: c.phoneE164,
});

async function briefs(businessId: string, ids: (Types.ObjectId | null)[]) {
  const real = ids.filter((i): i is Types.ObjectId => i !== null);
  const rows = real.length ? await Contact.find({ businessId, _id: { $in: real } }).lean() : [];
  return new Map(rows.map((c) => [String(c._id), brief(c)]));
}

export function staffView(r: RewardDoc, contacts: Map<string, Brief>, now = new Date()) {
  return {
    id: String(r._id),
    code: r.code,
    status: effectiveStatus(r, now),
    ruleName: r.ruleName,
    campaignId: r.campaignId ? String(r.campaignId) : null,
    ruleId: r.ruleId ? String(r.ruleId) : null,
    incidentId: r.incidentId ? String(r.incidentId) : null,
    responseId: r.responseId ? String(r.responseId) : null,
    contact: r.contactId ? (contacts.get(String(r.contactId)) ?? null) : null,
    discount: discountOf(r),
    terms: r.terms,
    createdAt: r.createdAt,
    issuedAt: r.issuedAt,
    expiresAt: r.expiresAt,
    decisionNote: r.decisionNote,
    deliveries: r.deliveries.map((d) => ({ method: d.method, at: d.at })),
    redemption: r.redemption
      ? {
          at: r.redemption.at,
          orderTotal: r.redemption.orderTotal,
          discountApplied: r.redemption.discountApplied,
        }
      : null,
    shareUrl: `${env.PUBLIC_APP_BASE_URL.replace(/\/+$/, '')}/reward/${signToken(r._id)}`,
  };
}

async function oneView(businessId: string, r: RewardDoc) {
  return staffView(r, await briefs(businessId, [r.contactId]));
}

// ---- rules -------------------------------------------------------------------------------------

export const TEMPLATES = [
  {
    id: 'apology-percent',
    name: 'We are sorry: 15% off your next visit',
    description: 'A percentage apology, reviewed by you before it is sent.',
    rule: {
      name: 'Apology: 15% off',
      maxRating: 2,
      mode: 'approval',
      discountType: 'percent',
      discountValue: 15,
      maxDiscount: 20,
      validityDays: 30,
      cooldownDays: 30,
      terms: 'One use per customer. Cannot be combined with other offers.',
    },
  },
  {
    id: 'apology-fixed',
    name: 'We are sorry: 5 off any order over 20',
    description: 'A fixed amount issued automatically right after the complaint.',
    rule: {
      name: 'Apology: 5 off',
      maxRating: 2,
      mode: 'auto',
      discountType: 'fixed',
      discountValue: 5,
      minSpend: 20,
      validityDays: 30,
      cooldownDays: 30,
      terms: 'One use per customer. Minimum spend applies.',
    },
  },
];

const ruleDto = (r: RewardRuleDoc) => ({
  id: String(r._id),
  name: r.name,
  enabled: r.enabled,
  maxRating: r.maxRating,
  mode: r.mode,
  discountType: r.discountType,
  discountValue: r.discountValue,
  currency: r.currency,
  minSpend: r.minSpend,
  maxDiscount: r.maxDiscount,
  validityDays: r.validityDays,
  cooldownDays: r.cooldownDays,
  maxIssuancesTotal: r.maxIssuancesTotal,
  maxIssuancesPerDay: r.maxIssuancesPerDay,
  terms: r.terms,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export async function listRules(businessId: string) {
  const rows = await RewardRule.find({ businessId }).sort({ createdAt: -1 }).lean();
  return rows.map(ruleDto);
}

export async function createRule(businessId: string, userId: string, input: RuleInput) {
  const rule = (
    await RewardRule.create({ ...input, businessId: oid(businessId), createdByUserId: oid(userId) })
  ).toObject();
  await audit(businessId, 'rule_created', {
    actor: userId,
    rule: rule._id,
    details: { name: rule.name },
  });
  return ruleDto(rule);
}

export async function updateRule(
  businessId: string,
  userId: string,
  ruleId: string,
  patch: Partial<RuleInput>,
) {
  if (!OBJECT_ID.test(ruleId)) throw notFound('Rule not found');
  const rule = await RewardRule.findOne({ _id: ruleId, businessId });
  if (!rule) throw notFound('Rule not found');
  const next = { ...rule.toObject(), ...patch };
  if (next.discountType === 'percent' && next.discountValue > 100) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Percent must be 1-100');
  }
  if (next.discountType === 'fixed' && next.maxDiscount != null) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'Maximum discount only applies to percentage rewards',
    );
  }
  rule.set(patch);
  await rule.save();
  await audit(businessId, patch.enabled === false ? 'rule_disabled' : 'rule_updated', {
    actor: userId,
    rule: rule._id,
    details: { changed: Object.keys(patch) },
  });
  return ruleDto(rule.toObject());
}

// ---- issuance ----------------------------------------------------------------------------------

/** Conditional upsert on a unique key: true if a slot was reserved, false if the cap is reached. */
async function reserve(key: string, max: number): Promise<boolean> {
  try {
    await RewardQuota.updateOne(
      { key, count: { $lt: max } },
      { $inc: { count: 1 } },
      { upsert: true },
    );
    return true;
  } catch (e) {
    if (isDup(e)) return false;
    throw e;
  }
}
const release = (key: string) => RewardQuota.updateOne({ key }, { $inc: { count: -1 } });

async function newRewardDoc(
  rule: Pick<
    RewardRuleDoc,
    | '_id'
    | 'name'
    | 'discountType'
    | 'discountValue'
    | 'currency'
    | 'minSpend'
    | 'maxDiscount'
    | 'validityDays'
    | 'terms'
  >,
  base: Pick<
    RewardDoc,
    'businessId' | 'incidentId' | 'responseId' | 'contactId' | 'identityHash'
  > & { campaignRecipientId?: Types.ObjectId },
  status: RewardDoc['status'],
  now: Date,
  actor: string | null,
): Promise<RewardDoc> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const issued = status === 'issued';
      const doc = await Reward.create({
        ...base,
        ruleId: base.campaignRecipientId ? null : rule._id,
        campaignId: base.campaignRecipientId ? rule._id : null,
        ruleName: rule.name,
        code: newCode(),
        status,
        discountType: rule.discountType,
        discountValue: rule.discountValue,
        currency: rule.currency,
        minSpend: rule.minSpend,
        maxDiscount: rule.maxDiscount,
        validityDays: rule.validityDays,
        terms: rule.terms,
        issuedAt: issued ? now : null,
        expiresAt: issued ? new Date(now.getTime() + rule.validityDays * DAY) : null,
        decidedByUserId: actor ? oid(actor) : null,
      });
      return doc.toObject();
    } catch (e) {
      if (!isDup(e)) throw e;
      const msg = String((e as { message?: string }).message);
      if (msg.includes('responseId')) throw e; // one reward per response: caller handles
      // else: code collision, retry with a new code
    }
  }
  throw new Error('Could not allocate a reward code');
}

/** Campaign issuance uses the same immutable terms, codes, expiry and redemption lifecycle. */
export async function issueCampaignReward(
  campaignId: Types.ObjectId,
  recipientId: Types.ObjectId,
  contact: ContactDoc,
  name: string,
  offer: import('../campaigns/campaign.domain').CampaignInput['offer'],
  now: Date,
) {
  const filter = { businessId: contact.businessId, campaignRecipientId: recipientId };
  const existing = await Reward.findOne(filter).lean();
  if (existing) return existing;
  try {
    return await newRewardDoc(
      { _id: campaignId, name, ...offer },
      {
        businessId: contact.businessId,
        incidentId: null,
        responseId: null,
        contactId: contact._id,
        identityHash: identityHash(contact.businessId, contact, { ip: '', userAgent: '' }),
        campaignRecipientId: recipientId,
      },
      'issued',
      now,
      null,
    );
  } catch (error) {
    if (!isDup(error)) throw error;
    const winner = await Reward.findOne(filter).lean();
    if (!winner) throw error;
    return winner;
  }
}

/**
 * Called after a response is stored. Creates the incident for low ratings and, when the customer
 * is eligible, the reward. Fully idempotent per response, so retries and replays are safe.
 * Rewards never depend on reviews: nothing here looks at Google reviews at all.
 */
export async function processSubmission(
  response: ResponseDoc,
  contact: ContactDoc | null,
  client: Client,
  now = new Date(),
) {
  if (response.rating === null) return null;
  const businessId = response.businessId;

  const existing = await Reward.findOne({ businessId, responseId: response._id }).lean();
  if (existing) return customerView(existing, now);

  const rules = await RewardRule.find({
    businessId,
    enabled: true,
    maxRating: { $gte: response.rating },
  })
    .sort({ maxRating: 1, createdAt: 1 })
    .lean();
  const rule = rules[0];
  if (!rule) return null;

  let incident: IncidentDoc;
  try {
    incident = (
      await Incident.create({
        businessId,
        responseId: response._id,
        contactId: response.contactId,
        rating: response.rating,
        ruleId: rule._id,
        status: 'open',
      })
    ).toObject();
    await audit(businessId, 'incident_created', {
      incident: incident._id,
      rule: rule._id,
      details: { rating: response.rating },
    });
  } catch (e) {
    if (!isDup(e)) throw e;
    incident = (await Incident.findOne({ businessId, responseId: response._id }).lean())!;
  }

  const setStatus = async (status: IncidentDoc['status'], reason: string | null) => {
    await Incident.updateOne({ _id: incident._id }, { $set: { status, reason } });
    await audit(businessId, status === 'no_reward' ? 'reward_denied' : 'incident_updated', {
      incident: incident._id,
      rule: rule._id,
      details: { status, reason },
    });
  };

  const idHash = identityHash(businessId, contact, client);

  // Rolling cooldown per customer identity (pending and issued rewards both count).
  if (rule.cooldownDays > 0) {
    const recent = await Reward.exists({
      businessId,
      identityHash: idHash,
      status: { $in: ['pending_approval', 'issued', 'redeemed'] },
      createdAt: { $gte: new Date(now.getTime() - rule.cooldownDays * DAY) },
    });
    if (recent) {
      await setStatus('no_reward', 'cooldown');
      return null;
    }
  }

  // Atomic reservations close the race between concurrent submissions.
  const reserved: string[] = [];
  const take = async (key: string, max: number | null) => {
    if (max === null) return true;
    if (!(await reserve(key, max))) return false;
    reserved.push(key);
    return true;
  };
  const day = now.toISOString().slice(0, 10);
  const bucket = rule.cooldownDays > 0 ? Math.floor(now.getTime() / (rule.cooldownDays * DAY)) : 0;
  const ok =
    (rule.cooldownDays === 0 || (await take(`cd:${businessId}:${idHash}:${bucket}`, 1))) &&
    (await take(`tot:${rule._id}`, rule.maxIssuancesTotal)) &&
    (await take(`day:${rule._id}:${day}`, rule.maxIssuancesPerDay));
  if (!ok) {
    await Promise.all(reserved.map(release));
    await setStatus('no_reward', 'limit');
    return null;
  }

  try {
    const status = rule.mode === 'auto' ? 'issued' : 'pending_approval';
    const reward = await newRewardDoc(
      rule,
      {
        businessId,
        incidentId: incident._id,
        responseId: response._id,
        contactId: response.contactId,
        identityHash: idHash,
      },
      status,
      now,
      null,
    );
    await Incident.updateOne(
      { _id: incident._id },
      { $set: { status: status === 'issued' ? 'reward_issued' : 'reward_pending', reason: null } },
    );
    await audit(businessId, status === 'issued' ? 'reward_issued_auto' : 'reward_pending', {
      reward: reward._id,
      incident: incident._id,
      rule: rule._id,
    });
    return customerView(reward, now);
  } catch (e) {
    await Promise.all(reserved.map(release));
    if (isDup(e)) {
      const won = await Reward.findOne({ businessId, responseId: response._id }).lean();
      return won ? customerView(won, now) : null;
    }
    throw e;
  }
}

/** Owner override: issue a reward for an incident that did not get one. */
export async function issueManually(
  businessId: string,
  userId: string,
  incidentId: string,
  ruleId?: string,
) {
  if (!OBJECT_ID.test(incidentId)) throw notFound('Incident not found');
  const incident = await Incident.findOne({ _id: incidentId, businessId }).lean();
  if (!incident) throw notFound('Incident not found');
  const rid = ruleId ?? (incident.ruleId ? String(incident.ruleId) : null);
  const rule =
    rid && OBJECT_ID.test(rid) ? await RewardRule.findOne({ _id: rid, businessId }).lean() : null;
  if (!rule) throw new AppError(422, 'RULE_REQUIRED', 'Choose a reward rule to issue');
  const response = await Response.findOne({ _id: incident.responseId, businessId }).lean();
  if (!response) throw notFound('Response not found');
  const contact = response.contactId ? await Contact.findById(response.contactId).lean() : null;
  const now = new Date();
  try {
    const reward = await newRewardDoc(
      rule,
      {
        businessId: oid(businessId),
        incidentId: incident._id,
        responseId: incident.responseId,
        contactId: incident.contactId,
        identityHash: identityHash(oid(businessId), contact, { ip: '', userAgent: '' }),
      },
      'issued',
      now,
      userId,
    );
    await Incident.updateOne(
      { _id: incident._id },
      { $set: { status: 'reward_issued', reason: null } },
    );
    await audit(businessId, 'reward_issued_manual', {
      actor: userId,
      reward: reward._id,
      incident: incident._id,
      rule: rule._id,
    });
    return oneView(businessId, reward);
  } catch (e) {
    if (isDup(e)) throw new AppError(409, 'REWARD_EXISTS', 'This incident already has a reward');
    throw e;
  }
}

async function decide(
  businessId: string,
  userId: string,
  rewardId: string,
  from: RewardDoc['status'][],
  to: RewardDoc['status'],
  action: string,
  note: string | undefined,
  now = new Date(),
) {
  if (!OBJECT_ID.test(rewardId)) throw notFound('Reward not found');
  const current = await Reward.findOne({ _id: rewardId, businessId }).lean();
  if (!current) throw notFound('Reward not found');
  const set: Record<string, unknown> = {
    status: to,
    decidedByUserId: oid(userId),
    decisionNote: note ?? null,
  };
  if (to === 'issued') {
    set['issuedAt'] = now;
    set['expiresAt'] = new Date(now.getTime() + current.validityDays * DAY);
  }
  const updated = await Reward.findOneAndUpdate(
    { _id: rewardId, businessId, status: { $in: from } },
    { $set: set },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) {
    throw new AppError(
      409,
      'INVALID_STATE',
      `Reward is ${effectiveStatus(current, now)}, cannot ${action}`,
    );
  }
  if (updated.incidentId) {
    await Incident.updateOne(
      { _id: updated.incidentId },
      {
        $set:
          to === 'issued'
            ? { status: 'reward_issued', reason: null }
            : to === 'rejected'
              ? { status: 'no_reward', reason: 'rejected' }
              : {},
      },
    );
  }
  await audit(businessId, `reward_${action}`, {
    actor: userId,
    reward: updated._id,
    details: { note: note ?? null },
  });
  return oneView(businessId, updated);
}

export const approveReward = (b: string, u: string, id: string, note?: string) =>
  decide(b, u, id, ['pending_approval'], 'issued', 'approved', note);
export const rejectReward = (b: string, u: string, id: string, note?: string) =>
  decide(b, u, id, ['pending_approval'], 'rejected', 'rejected', note);
export const cancelReward = (b: string, u: string, id: string, note?: string) =>
  decide(b, u, id, ['issued'], 'cancelled', 'cancelled', note);

/** Records that staff shared the reward by hand. This never claims a message was delivered. */
export async function recordShare(
  businessId: string,
  userId: string,
  rewardId: string,
  method: string,
) {
  if (!OBJECT_ID.test(rewardId)) throw notFound('Reward not found');
  const r = await Reward.findOneAndUpdate(
    { _id: rewardId, businessId, status: 'issued' },
    { $push: { deliveries: { method, at: new Date(), byUserId: oid(userId) } } },
    { returnDocument: 'after' },
  ).lean();
  if (!r) throw new AppError(409, 'INVALID_STATE', 'Only issued rewards can be shared');
  await audit(businessId, 'reward_shared_manually', {
    actor: userId,
    reward: r._id,
    details: { method },
  });
  return oneView(businessId, r);
}

export async function resolveIncident(
  businessId: string,
  userId: string,
  id: string,
  note?: string,
) {
  if (!OBJECT_ID.test(id)) throw notFound('Incident not found');
  const i = await Incident.findOneAndUpdate(
    { _id: id, businessId },
    { $set: { status: 'resolved', note: note ?? null } },
    { returnDocument: 'after' },
  ).lean();
  if (!i) throw notFound('Incident not found');
  await audit(businessId, 'incident_resolved', {
    actor: userId,
    incident: i._id,
    details: { note: note ?? null },
  });
  return incidentDto(i, new Map(), null);
}

// ---- redemption --------------------------------------------------------------------------------

function discountApplied(r: RewardDoc, total: number | undefined): number | null {
  if (total === undefined) return null;
  if (r.discountType === 'fixed') return round2(Math.min(r.discountValue, total));
  const pct = (total * r.discountValue) / 100;
  return round2(r.maxDiscount != null ? Math.min(pct, r.maxDiscount) : pct);
}

async function byCode(businessId: string, raw: string) {
  const code = normalizeCode(raw);
  const r = code ? await Reward.findOne({ businessId, code }).lean() : null;
  if (!r) throw new AppError(404, 'REWARD_NOT_FOUND', 'No reward found for that code');
  return r;
}

export async function verifyCode(businessId: string, raw: string) {
  const r = await byCode(businessId, raw);
  const status = effectiveStatus(r);
  const reason =
    status === 'issued'
      ? null
      : status === 'pending_approval'
        ? 'Waiting for approval'
        : status === 'redeemed'
          ? 'Already redeemed'
          : status === 'expired'
            ? 'Expired'
            : status === 'cancelled'
              ? 'Cancelled'
              : 'Not valid';
  return { redeemable: status === 'issued', reason, reward: await oneView(businessId, r) };
}

export async function redeem(
  businessId: string,
  userId: string,
  raw: string,
  requestId: string,
  orderTotal?: number,
  orderId?: string,
) {
  const r = await byCode(businessId, raw);
  const now = new Date();
  if (r.status === 'redeemed') {
    if (r.redemption?.requestId === requestId) {
      if (r.campaignId && r.redemption.orderId !== orderId?.trim())
        throw new AppError(
          409,
          'ORDER_REWARD_CONFLICT',
          'Retry must use the original order reference',
        );
      return { duplicate: true, reward: await oneView(businessId, r) };
    }
    throw new AppError(409, 'REWARD_ALREADY_REDEEMED', 'This reward was already redeemed', {
      redeemedAt: r.redemption?.at,
    });
  }
  const status = effectiveStatus(r, now);
  if (r.campaignId) {
    const campaign = await Campaign.findOne({ _id: r.campaignId, businessId }).lean();
    const business = await Business.exists({
      _id: businessId,
      status: 'active',
      adminState: { $nin: ['suspended', 'archived'] },
    });
    if (!campaign || campaign.status === 'cancelled' || !business)
      throw new AppError(409, 'REWARD_NOT_REDEEMABLE', 'Campaign or business is unavailable');
    if (!orderId?.trim())
      throw new AppError(
        422,
        'ORDER_REQUIRED',
        'Campaign rewards require the actual order reference',
      );
  }
  if (status === 'expired') throw new AppError(409, 'REWARD_EXPIRED', 'This reward has expired');
  if (status !== 'issued') {
    throw new AppError(409, 'REWARD_NOT_REDEEMABLE', `This reward is ${status.replace('_', ' ')}`);
  }
  if (r.minSpend !== null && (orderTotal === undefined || orderTotal < r.minSpend)) {
    throw new AppError(
      422,
      'MIN_SPEND_NOT_MET',
      `Minimum spend of ${r.minSpend} ${r.currency} not met`,
      { minSpend: r.minSpend },
    );
  }
  // Single-use guarantee: only one concurrent request can flip issued -> redeemed.
  if (orderId) {
    const order = { businessId: oid(businessId), orderId: orderId.trim() };
    try {
      await RewardOrderClaim.updateOne(
        order,
        { $setOnInsert: { rewardId: r._id, requestId, at: now } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDup(error)) throw error;
    }
    const claim = await RewardOrderClaim.findOne(order).lean();
    if (!claim || String(claim.rewardId) !== String(r._id) || claim.requestId !== requestId)
      throw new AppError(
        409,
        'ORDER_REWARD_CONFLICT',
        'An offer is already reserved or redeemed for this order',
      );
  }
  const updated = await Reward.findOneAndUpdate(
    { _id: r._id, businessId, status: 'issued', expiresAt: { $gt: now } },
    {
      $set: {
        status: 'redeemed',
        redemption: {
          at: now,
          byUserId: oid(userId),
          requestId,
          orderId: orderId?.trim() ?? null,
          orderTotal: orderTotal ?? null,
          discountApplied: discountApplied(r, orderTotal),
        },
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) {
    const fresh = await Reward.findById(r._id).lean();
    if (fresh?.status === 'redeemed' && fresh.redemption?.requestId === requestId) {
      return { duplicate: true, reward: await oneView(businessId, fresh) };
    }
    throw new AppError(409, 'REWARD_ALREADY_REDEEMED', 'This reward was already redeemed');
  }
  await audit(businessId, 'reward_redeemed', {
    actor: userId,
    reward: updated._id,
    details: {
      orderTotal: orderTotal ?? null,
      discountApplied: updated.redemption?.discountApplied ?? null,
    },
  });
  return { duplicate: false, reward: await oneView(businessId, updated) };
}

// ---- reads -------------------------------------------------------------------------------------

export async function listRewards(businessId: string, q: z.infer<typeof listRewardsQuery>) {
  const bid = oid(businessId);
  const now = new Date();
  const filter: QueryFilter<RewardDoc> = { businessId: bid };
  if (q.status === 'expired') Object.assign(filter, { status: 'issued', expiresAt: { $lte: now } });
  else if (q.status === 'issued')
    Object.assign(filter, { status: 'issued', expiresAt: { $gt: now } });
  else if (q.status) filter.status = q.status;
  if (q.search) {
    const matching = await Contact.find(
      { businessId: bid, ...contactSearchFilter(q.search) },
      { _id: 1 },
    ).lean();
    filter.$or = [
      { code: new RegExp(escapeRegex(q.search.toUpperCase().replace(/\s+/g, '')), 'i') },
      ...(matching.length ? [{ contactId: { $in: matching.map((c) => c._id) } }] : []),
    ];
  }
  const [rows, total] = await Promise.all([
    Reward.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Reward.countDocuments(filter),
  ]);
  const contacts = await briefs(
    businessId,
    rows.map((r) => r.contactId),
  );
  return {
    data: rows.map((r) => staffView(r, contacts, now)),
    pagination: pageMeta(q.page, q.pageSize, total),
  };
}

export async function getReward(businessId: string, id: string) {
  if (!OBJECT_ID.test(id)) throw notFound('Reward not found');
  const r = await Reward.findOne({ _id: id, businessId }).lean();
  if (!r) throw notFound('Reward not found');
  const history = await RewardAudit.find({ businessId, rewardId: r._id }).sort({ at: 1 }).lean();
  return {
    reward: await oneView(businessId, r),
    history: history.map((h) => ({
      action: h.action,
      at: h.at,
      details: h.details,
      byUser: !!h.actorUserId,
    })),
  };
}

function incidentDto(i: IncidentDoc, contacts: Map<string, Brief>, reward: RewardDoc | null) {
  return {
    id: String(i._id),
    responseId: String(i.responseId),
    rating: i.rating,
    status: i.status,
    reason: i.reason,
    note: i.note,
    ruleId: i.ruleId ? String(i.ruleId) : null,
    contact: i.contactId ? (contacts.get(String(i.contactId)) ?? null) : null,
    rewardId: reward ? String(reward._id) : null,
    createdAt: i.createdAt,
  };
}

export async function listIncidents(businessId: string, q: z.infer<typeof listIncidentsQuery>) {
  const filter: QueryFilter<IncidentDoc> = { businessId: oid(businessId) };
  if (q.status) filter.status = q.status;
  const [rows, total] = await Promise.all([
    Incident.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Incident.countDocuments(filter),
  ]);
  const contacts = await briefs(
    businessId,
    rows.map((r) => r.contactId),
  );
  const rewards = await Reward.find({
    businessId,
    incidentId: { $in: rows.map((r) => r._id) },
  }).lean();
  const byIncident = new Map(rewards.map((r) => [String(r.incidentId), r]));
  return {
    data: rows.map((i) => incidentDto(i, contacts, byIncident.get(String(i._id)) ?? null)),
    pagination: pageMeta(q.page, q.pageSize, total),
  };
}

export async function publicCard(token: string) {
  const id = parseToken(token);
  const r = id ? await Reward.findById(id).lean() : null;
  const business = r ? await Business.findById(r.businessId, { name: 1, status: 1 }).lean() : null;
  if (!r || !business || business.status === 'disabled') {
    throw new AppError(404, 'REWARD_NOT_FOUND', 'This reward link is not valid.');
  }
  return { business: { name: business.name }, reward: customerView(r) };
}

export async function getSummary(
  businessId: string,
  q: z.infer<typeof summaryQuery>,
  now = new Date(),
) {
  const bid = oid(businessId);
  const business = await Business.findById(bid, { timezone: 1 }).lean();
  if (!business) throw notFound('Business not found');
  const tz = business.timezone;
  const dates = lastDays(q.days, tz, now);
  const since = new Date(now.getTime() - (q.days + 1) * DAY);
  const perDay = (model: typeof Reward | typeof Incident, field: string, extra: object = {}) =>
    (model as typeof Reward).aggregate<{ _id: string; n: number }>([
      { $match: { businessId: bid, [field]: { $gte: since }, ...extra } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: tz } },
          n: { $sum: 1 },
        },
      },
    ]);

  const [byStatus, expired, incidents, cost, noTotal, issuedDays, redeemedDays, incidentDays] =
    await Promise.all([
      Reward.aggregate<{ _id: string; n: number }>([
        { $match: { businessId: bid } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      Reward.countDocuments({ businessId: bid, status: 'issued', expiresAt: { $lte: now } }),
      Incident.countDocuments({ businessId: bid }),
      Reward.aggregate<{ _id: string; amount: number; n: number }>([
        {
          $match: {
            businessId: bid,
            status: 'redeemed',
            'redemption.discountApplied': { $ne: null },
          },
        },
        {
          $group: {
            _id: '$currency',
            amount: { $sum: '$redemption.discountApplied' },
            n: { $sum: 1 },
          },
        },
      ]),
      Reward.countDocuments({
        businessId: bid,
        status: 'redeemed',
        'redemption.discountApplied': null,
      }),
      perDay(Reward, 'issuedAt'),
      perDay(Reward, 'redemption.at', { status: 'redeemed' }),
      perDay(Incident, 'createdAt'),
    ]);
  const n = (s: string) => byStatus.find((b) => b._id === s)?.n ?? 0;
  const issuedAll = n('issued') + n('redeemed') + n('cancelled');
  const m = (rows: { _id: string; n: number }[]) => new Map(rows.map((r) => [r._id, r.n]));
  const [i, iss, red] = [m(incidentDays), m(issuedDays), m(redeemedDays)];
  return {
    days: q.days,
    timezone: tz,
    totals: {
      incidents,
      issued: issuedAll,
      active: n('issued') - expired,
      redeemed: n('redeemed'),
      expired,
      pendingApproval: n('pending_approval'),
      rejected: n('rejected'),
      cancelled: n('cancelled'),
      redemptionRate: issuedAll > 0 ? Math.round((n('redeemed') / issuedAll) * 1000) / 10 : null,
    },
    /** Discount given, from order totals staff entered at redemption. Not revenue. */
    cost: {
      byCurrency: cost.map((c) => ({
        currency: c._id,
        amount: round2(c.amount),
        redemptions: c.n,
      })),
      redemptionsWithoutTotal: noTotal,
    },
    trend: dates.map((date) => ({
      date,
      incidents: i.get(date) ?? 0,
      issued: iss.get(date) ?? 0,
      redeemed: red.get(date) ?? 0,
    })),
  };
}

export const assertOwner = (role: string | undefined) => {
  if (role !== 'owner') throw forbidden('Only the owner can do this');
};
