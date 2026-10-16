import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { User } from '../src/modules/auth/user.model';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { ConsentEvent, Contact } from '../src/modules/contacts/contact.model';
import { QrEvent } from '../src/modules/qr/qr-event.model';
import {
  Questionnaire,
  QuestionnaireVersion,
} from '../src/modules/questionnaires/questionnaire.model';
import { Response } from '../src/modules/responses/response.model';
import {
  Incident,
  Reward,
  RewardAudit,
  RewardQuota,
  RewardRule,
} from '../src/modules/rewards/reward.model';
import {
  newCode,
  normalizeCode,
  parseToken,
  signToken,
} from '../src/modules/rewards/reward.service';

const PASSWORD = 'correct-horse-battery';
let seq = 0;

interface Actor {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

async function newActor(): Promise<Actor> {
  const agent = request.agent(createApp());
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  const res = await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({ fullName: 'Person', email: `r${++seq}-${Date.now()}@example.com`, password: PASSWORD });
  const h = (r: request.Test) => r.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    userId: res.body.data.user.id,
    get: (url) => agent.get(url),
    post: (url, body = {}) => h(agent.post(url)).send(body),
    patch: (url, body = {}) => h(agent.patch(url)).send(body),
  };
}

interface World {
  owner: Actor;
  staff: Actor;
  businessId: string;
  slug: string;
  rating: string;
  text: string;
  base: string;
}

async function newWorld(name = 'Harbor Cafe'): Promise<World> {
  const owner = await newActor();
  const staff = await newActor();
  const b = (
    await owner.post('/api/v1/businesses', {
      createRequestId: randomUUID(),
      name,
      category: 'Cafe',
      timezone: 'UTC',
      googleReviewUrl: 'https://g.page/r/harbor/review',
    })
  ).body.data.business as { id: string; slug: string };
  await BusinessMembership.create({ businessId: b.id, userId: staff.userId, role: 'member' });
  const qBase = `/api/v1/businesses/${b.id}/questionnaire`;
  const v = (await owner.get(qBase)).body.data.questionnaire;
  // Use the agent's own PUT (it carries the session cookies).
  const put = await owner.agent
    .put(`${qBase}/draft`)
    .set('X-CSRF-Token', owner.csrf)
    .send({
      baseRevision: v.draftRevision,
      title: 'Feedback',
      questions: [
        { type: 'rating', label: 'Rate us', required: true },
        { type: 'long_text', label: 'Comments', required: false },
      ],
    });
  await owner.post(`${qBase}/publish`, {
    expectedRevision: put.body.data.questionnaire.draftRevision,
  });
  const form = (await request(createApp()).get(`/api/v1/public/${b.slug}`)).body.data.questionnaire
    .questions as { id: string; type: string }[];
  return {
    owner,
    staff,
    businessId: b.id,
    slug: b.slug,
    rating: form.find((q) => q.type === 'rating')!.id,
    text: form.find((q) => q.type === 'long_text')!.id,
    base: `/api/v1/businesses/${b.id}`,
  };
}

const MODELS = [
  User,
  RefreshToken,
  Business,
  BusinessMembership,
  Questionnaire,
  QuestionnaireVersion,
  Response,
  Contact,
  ConsentEvent,
  QrEvent,
  RewardRule,
  Incident,
  Reward,
  RewardQuota,
  RewardAudit,
];

let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  await Promise.all(MODELS.map((m) => (m as typeof User).init()));
});
beforeEach(async () => {
  app = createApp();
  await Promise.all(MODELS.map((m) => (m as typeof User).deleteMany({})));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const ruleBody = (over: object = {}) => ({
  name: 'Apology',
  maxRating: 2,
  mode: 'auto',
  discountType: 'percent',
  discountValue: 10,
  validityDays: 30,
  cooldownDays: 30,
  ...over,
});

const addRule = async (w: World, over: object = {}) =>
  (await w.owner.post(`${w.base}/reward-rules`, ruleBody(over))).body.data as { id: string };

interface Sub {
  rating?: number;
  ua?: string;
  phone?: string;
  email?: string;
  key?: string;
  text?: string;
}
const submit = (w: World, s: Sub = {}, a = app) =>
  request(a)
    .post(`/api/v1/public/${w.slug}/responses`)
    .set('User-Agent', s.ua ?? 'Phone A')
    .send({
      idempotencyKey: s.key ?? randomUUID(),
      answers: [
        { questionId: w.rating, rating: s.rating ?? 1 },
        ...(s.text ? [{ questionId: w.text, text: s.text }] : []),
      ],
      contact: s.phone || s.email ? { phone: s.phone, email: s.email } : undefined,
    });

const CODE = /^GDV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

describe('reward rules', () => {
  it('lets the owner create, edit and disable rules; validates the discount', async () => {
    const w = await newWorld();
    const ok = await w.owner.post(`${w.base}/reward-rules`, ruleBody());
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({
      maxRating: 2,
      mode: 'auto',
      currency: 'USD',
      enabled: true,
    });
    expect(
      (await w.owner.post(`${w.base}/reward-rules`, ruleBody({ discountValue: 150 }))).status,
    ).toBe(422);
    expect(
      (
        await w.owner.post(
          `${w.base}/reward-rules`,
          ruleBody({ discountType: 'fixed', maxDiscount: 5 }),
        )
      ).status,
    ).toBe(422);
    expect((await w.owner.post(`${w.base}/reward-rules`, ruleBody({ maxRating: 9 }))).status).toBe(
      422,
    );
    expect((await w.owner.post(`${w.base}/reward-rules`, ruleBody({ extra: 1 }))).status).toBe(422);
    const patched = await w.owner.patch(`${w.base}/reward-rules/${ok.body.data.id}`, {
      enabled: false,
      discountValue: 12,
    });
    expect(patched.body.data).toMatchObject({ enabled: false, discountValue: 12 });
    expect(
      (await w.owner.patch(`${w.base}/reward-rules/${ok.body.data.id}`, { discountValue: 500 }))
        .status,
    ).toBe(422);
    expect((await w.owner.get(`${w.base}/reward-rules`)).body.data).toHaveLength(1);
    const actions = (await RewardAudit.find({ businessId: w.businessId }).lean()).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['rule_created', 'rule_disabled']));
  });

  it('keeps rule management owner-only and tenant-isolated', async () => {
    const w = await newWorld();
    const other = await newWorld('Other Cafe');
    expect((await w.staff.post(`${w.base}/reward-rules`, ruleBody())).status).toBe(403);
    expect((await w.staff.get(`${w.base}/reward-rules`)).status).toBe(200);
    expect((await other.owner.get(`${w.base}/reward-rules`)).status).toBe(403);
    expect((await request(app).get(`${w.base}/reward-rules`)).status).toBe(401);
    const rule = await addRule(w);
    expect(
      (await other.owner.patch(`${other.base}/reward-rules/${rule.id}`, { enabled: false })).status,
    ).toBe(404);
  });

  it('offers ready-made templates that are valid rules', async () => {
    const w = await newWorld();
    const t = (await w.owner.get(`${w.base}/rewards/templates`)).body.data as { rule: object }[];
    expect(t.length).toBeGreaterThan(1);
    for (const tpl of t)
      expect((await w.owner.post(`${w.base}/reward-rules`, tpl.rule)).status).toBe(201);
  });
});

describe('complaint to reward workflow', () => {
  it('does nothing without a matching enabled rule, or for ratings above the threshold', async () => {
    const w = await newWorld();
    expect((await submit(w, { rating: 1 })).body.data.reward).toBeNull();
    expect(await Incident.countDocuments()).toBe(0);
    await addRule(w, { maxRating: 2 });
    expect((await submit(w, { rating: 3, ua: 'B' })).body.data.reward).toBeNull();
    expect((await submit(w, { rating: 5, ua: 'C' })).body.data.reward).toBeNull();
    expect(await Incident.countDocuments()).toBe(0);
    await addRule(w, { name: 'Off', enabled: false, maxRating: 5 });
    expect((await submit(w, { rating: 4, ua: 'D' })).body.data.reward).toBeNull();
  });

  it('auto-issues a reward with a secure code, an incident and an audit trail', async () => {
    const w = await newWorld();
    await addRule(w);
    const res = await submit(w, { rating: 2, text: 'cold coffee' });
    expect(res.status).toBe(201);
    const r = res.body.data.reward;
    expect(r.status).toBe('issued');
    expect(r.code).toMatch(CODE);
    expect(r.discount).toMatchObject({ type: 'percent', value: 10, currency: 'USD' });
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
    const inc = (await Incident.findOne().lean())!;
    expect(inc).toMatchObject({ rating: 2, status: 'reward_issued' });
    const actions = (await RewardAudit.find().lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['incident_created', 'reward_issued_auto']));
    // The stored coupon never depends on Google reviews: a business without a link works the same.
    expect(JSON.stringify(res.body)).not.toMatch(/review requirement/i);
  });

  it('holds approval-mode rewards until the owner approves; staff cannot decide', async () => {
    const w = await newWorld();
    await addRule(w, { mode: 'approval' });
    const r = (await submit(w, { rating: 1 })).body.data.reward;
    expect(r.status).toBe('pending_approval');
    expect(r.code).toBeNull();
    expect(r.expiresAt).toBeNull();
    const rewardId = (await Reward.findOne().lean())!._id;
    const url = `${w.base}/rewards/${rewardId}`;
    expect((await w.staff.post(`${url}/approve`)).status).toBe(403);
    // Not redeemable while pending.
    const code = (await Reward.findById(rewardId).lean())!.code;
    const verify = await w.staff.post(`${w.base}/rewards/verify`, { code });
    expect(verify.body.data).toMatchObject({ redeemable: false, reason: 'Waiting for approval' });
    const approved = await w.owner.post(`${url}/approve`, { note: 'sorry!' });
    expect(approved.body.data.status).toBe('issued');
    expect(approved.body.data.expiresAt).toBeTruthy();
    expect((await w.owner.post(`${url}/approve`)).status).toBe(409);
    expect((await Incident.findOne().lean())!.status).toBe('reward_issued');
    const card = await request(app).get(`/api/v1/public/rewards/${r.token}`);
    expect(card.body.data.reward).toMatchObject({ status: 'issued', code });
  });

  it('can reject a pending reward, which closes the incident without a reward', async () => {
    const w = await newWorld();
    await addRule(w, { mode: 'approval' });
    await submit(w, { rating: 1 });
    const id = (await Reward.findOne().lean())!._id;
    const rej = await w.owner.post(`${w.base}/rewards/${id}/reject`, { note: 'duplicate' });
    expect(rej.body.data.status).toBe('rejected');
    expect(await Incident.findOne().lean()).toMatchObject({
      status: 'no_reward',
      reason: 'rejected',
    });
    expect((await w.owner.post(`${w.base}/rewards/${id}/approve`)).status).toBe(409);
  });

  it('picks the most specific enabled rule (lowest threshold that matches)', async () => {
    const w = await newWorld();
    await addRule(w, { name: 'Broad', maxRating: 3, discountValue: 5 });
    await addRule(w, { name: 'Severe', maxRating: 1, discountValue: 20 });
    expect((await submit(w, { rating: 1 })).body.data.reward.discount.value).toBe(20);
    expect((await submit(w, { rating: 3, ua: 'B' })).body.data.reward.discount.value).toBe(5);
  });

  it('snapshots the rule: later edits do not change issued rewards', async () => {
    const w = await newWorld();
    const rule = await addRule(w, { discountValue: 10 });
    await submit(w, { rating: 1 });
    await w.owner.patch(`${w.base}/reward-rules/${rule.id}`, { discountValue: 50, enabled: false });
    expect((await Reward.findOne().lean())!.discountValue).toBe(10);
  });
});

describe('abuse protection', () => {
  it('returns the same reward for a retried submission and never issues twice', async () => {
    const w = await newWorld();
    await addRule(w);
    const key = randomUUID();
    const a = await submit(w, { rating: 1, key });
    const b = await submit(w, { rating: 1, key });
    expect(b.status).toBe(200);
    expect(b.body.data.reward.token).toBe(a.body.data.reward.token);
    expect(b.body.data.reward.code).toBe(a.body.data.reward.code);
    expect(await Reward.countDocuments()).toBe(1);
  });

  it('applies the cooldown to repeated anonymous submissions from one device', async () => {
    const w = await newWorld();
    await addRule(w);
    expect((await submit(w, { rating: 1, ua: 'Same device' })).body.data.reward).not.toBeNull();
    const again = await submit(w, { rating: 1, ua: 'Same device' });
    expect(again.status).toBe(201);
    expect(again.body.data.reward).toBeNull();
    expect(await Reward.countDocuments()).toBe(1);
    expect(await Incident.findOne({ status: 'no_reward' }).lean()).toMatchObject({
      reason: 'cooldown',
    });
    expect((await submit(w, { rating: 1, ua: 'Another device' })).body.data.reward).not.toBeNull();
  });

  it('applies the cooldown per identified customer (phone) across different submissions', async () => {
    const w = await newWorld();
    await addRule(w);
    const phone = '+14155550123';
    expect((await submit(w, { rating: 1, phone, ua: 'A' })).body.data.reward).not.toBeNull();
    expect((await submit(w, { rating: 1, phone, ua: 'B' })).body.data.reward).toBeNull();
    // Another business never shares cooldown state.
    const other = await newWorld('Other');
    await addRule(other);
    expect((await submit(other, { rating: 1, phone, ua: 'A' })).body.data.reward).not.toBeNull();
  });

  it('stores only an HMAC of the customer identity, never the raw phone/email/IP', async () => {
    const w = await newWorld();
    await addRule(w);
    await submit(w, { rating: 1, phone: '+14155550123', ua: 'Secret UA' });
    const raw = JSON.stringify(await Reward.find().lean());
    expect(raw).not.toMatch(/4155550123|Secret UA|127\.0\.0\.1/);
    expect((await Reward.findOne().lean())!.identityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues exactly one reward when one customer submits concurrently', async () => {
    const w = await newWorld();
    await addRule(w);
    const phone = '+14155550199';
    const res = await Promise.all(
      Array.from({ length: 8 }, (_, i) => submit(w, { rating: 1, phone, ua: `P${i}` })),
    );
    expect(res.filter((r) => r.body.data.reward).length).toBe(1);
    expect(await Reward.countDocuments()).toBe(1);
  });

  it('enforces the total issuance cap atomically', async () => {
    const w = await newWorld();
    await addRule(w, { maxIssuancesTotal: 2, cooldownDays: 0 });
    const res = await Promise.all(
      Array.from({ length: 6 }, (_, i) => submit(w, { rating: 1, ua: `D${i}` })),
    );
    expect(res.filter((r) => r.body.data.reward).length).toBe(2);
    expect(await Reward.countDocuments()).toBe(2);
    expect(await Incident.countDocuments({ status: 'no_reward', reason: 'limit' })).toBe(4);
  });

  it('enforces the per-day cap', async () => {
    const w = await newWorld();
    await addRule(w, { maxIssuancesPerDay: 1, cooldownDays: 0 });
    expect((await submit(w, { rating: 1, ua: 'A' })).body.data.reward).not.toBeNull();
    expect((await submit(w, { rating: 1, ua: 'B' })).body.data.reward).toBeNull();
  });

  it('does not reward unrated responses', async () => {
    const w = await newWorld();
    await addRule(w, { maxRating: 5 });
    const res = await request(app)
      .post(`/api/v1/public/${w.slug}/responses`)
      .send({
        idempotencyKey: randomUUID(),
        answers: [{ questionId: w.rating, rating: 1 }],
        website: 'bot',
      });
    expect(res.body.data.reward).toBeNull(); // honeypot
    expect(await Reward.countDocuments()).toBe(0);
  });
});

describe('codes and tokens', () => {
  it('generates unique, well-formed codes and normalizes input', () => {
    const codes = new Set(Array.from({ length: 3000 }, newCode));
    expect(codes.size).toBe(3000);
    for (const c of [...codes].slice(0, 50)) expect(c).toMatch(CODE);
    const c = newCode();
    expect(normalizeCode(c.toLowerCase().replace(/-/g, ' '))).toBe(c);
    expect(normalizeCode(c.slice(4))).toBe(c);
    expect(normalizeCode('nope')).toBeNull();
    expect(normalizeCode('GDV-ILOU-ILOU')).toBeNull();
  });

  it('signs customer tokens so they cannot be forged', () => {
    const id = new mongoose.Types.ObjectId();
    const t = signToken(id);
    expect(parseToken(t)).toBe(String(id));
    expect(parseToken(t.slice(0, -2) + 'zz')).toBeNull();
    expect(parseToken(`${new mongoose.Types.ObjectId()}.${t.split('.')[1]}`)).toBeNull();
    expect(parseToken('garbage')).toBeNull();
  });
});

describe('redemption', () => {
  async function issued(w: World, over: object = {}, sub: Sub = {}) {
    await addRule(w, over);
    const res = await submit(w, { rating: 1, ...sub });
    return res.body.data.reward as { code: string; token: string };
  }
  const redeem = (w: World, who: Actor, body: object) => who.post(`${w.base}/rewards/redeem`, body);

  it('verifies, then redeems once; the same request id is idempotent', async () => {
    const w = await newWorld();
    const r = await issued(w);
    const v = await w.staff.post(`${w.base}/rewards/verify`, { code: r.code.toLowerCase() });
    expect(v.body.data).toMatchObject({ redeemable: true, reason: null });
    const requestId = randomUUID();
    const first = await redeem(w, w.staff, { code: r.code, requestId, orderTotal: 40 });
    expect(first.status).toBe(201);
    expect(first.body.data.reward).toMatchObject({ status: 'redeemed' });
    expect(first.body.data.reward.redemption).toMatchObject({ orderTotal: 40, discountApplied: 4 });
    const again = await redeem(w, w.staff, { code: r.code, requestId });
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    const other = await redeem(w, w.staff, { code: r.code, requestId: randomUUID() });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('REWARD_ALREADY_REDEEMED');
    expect(
      (await w.staff.post(`${w.base}/rewards/verify`, { code: r.code })).body.data.reason,
    ).toBe('Already redeemed');
  });

  it('redeems a code exactly once under concurrent attempts', async () => {
    const w = await newWorld();
    const r = await issued(w);
    const res = await Promise.all(
      Array.from({ length: 10 }, () =>
        redeem(w, w.staff, { code: r.code, requestId: randomUUID() }),
      ),
    );
    expect(res.filter((x) => x.status === 201)).toHaveLength(1);
    expect(res.filter((x) => x.status === 409)).toHaveLength(9);
    expect((await Reward.findOne().lean())!.status).toBe('redeemed');
  });

  it('enforces minimum spend, maximum discount and fixed-amount caps', async () => {
    const w = await newWorld();
    const r = await issued(w, { discountValue: 50, maxDiscount: 10, minSpend: 20 });
    expect(
      (await redeem(w, w.staff, { code: r.code, requestId: 'req-00000001' })).body.error.code,
    ).toBe('MIN_SPEND_NOT_MET');
    expect(
      (await redeem(w, w.staff, { code: r.code, requestId: 'req-00000002', orderTotal: 19 }))
        .status,
    ).toBe(422);
    const ok = await redeem(w, w.staff, {
      code: r.code,
      requestId: 'req-00000003',
      orderTotal: 100,
    });
    expect(ok.body.data.reward.redemption.discountApplied).toBe(10); // 50% of 100 capped at 10
    const w2 = await newWorld();
    const f = await issued(w2, { discountType: 'fixed', discountValue: 8, currency: 'eur' });
    const low = await redeem(w2, w2.staff, {
      code: f.code,
      requestId: 'req-00000004',
      orderTotal: 5,
    });
    expect(low.body.data.reward.redemption.discountApplied).toBe(5); // never more than the order
    expect(low.body.data.reward.discount.currency).toBe('EUR');
  });

  it('rejects expired, cancelled and pending codes, and records unknown total as unknown cost', async () => {
    const w = await newWorld();
    const r = await issued(w);
    await Reward.updateOne({ code: r.code }, { expiresAt: new Date(Date.now() - 1000) });
    const exp = await redeem(w, w.staff, { code: r.code, requestId: randomUUID() });
    expect(exp.body.error.code).toBe('REWARD_EXPIRED');
    expect(
      (await w.staff.post(`${w.base}/rewards/verify`, { code: r.code })).body.data.reward.status,
    ).toBe('expired');

    const w2 = await newWorld();
    const c = await issued(w2);
    const id = (await Reward.findOne({ businessId: w2.businessId }).lean())!._id;
    expect((await w2.staff.post(`${w2.base}/rewards/${id}/cancel`)).status).toBe(403);
    expect(
      (await w2.owner.post(`${w2.base}/rewards/${id}/cancel`, { note: 'mistake' })).body.data
        .status,
    ).toBe('cancelled');
    expect(
      (await redeem(w2, w2.staff, { code: c.code, requestId: randomUUID() })).body.error.code,
    ).toBe('REWARD_NOT_REDEEMABLE');

    const w3 = await newWorld();
    const u = await issued(w3);
    const done = await redeem(w3, w3.staff, { code: u.code, requestId: randomUUID() });
    expect(done.body.data.reward.redemption).toMatchObject({
      orderTotal: null,
      discountApplied: null,
    });
  });

  it('never accepts codes across businesses or malformed codes', async () => {
    const a = await newWorld();
    const b = await newWorld('Other');
    const r = await issued(a);
    const res = await redeem(b, b.staff, { code: r.code, requestId: randomUUID() });
    expect(res.status).toBe(404);
    expect((await b.owner.post(`${b.base}/rewards/verify`, { code: r.code })).status).toBe(404);
    expect((await a.staff.post(`${a.base}/rewards/verify`, { code: 'not a code!!' })).status).toBe(
      404,
    );
    expect((await redeem(a, a.staff, { code: r.code, requestId: 'short' })).status).toBe(422);
    expect(
      (await request(app).post(`${a.base}/rewards/verify`).send({ code: r.code })).status,
    ).toBe(403);
  });
});

describe('sharing, incidents and manual issue', () => {
  it('records manual shares without claiming delivery', async () => {
    const w = await newWorld();
    await addRule(w);
    await submit(w, { rating: 1, phone: '+14155550123' });
    const id = (await Reward.findOne().lean())!._id;
    const shared = await w.staff.post(`${w.base}/rewards/${id}/shared`, {
      method: 'whatsapp_link',
    });
    expect(shared.body.data.deliveries).toHaveLength(1);
    expect(shared.body.data.deliveries[0].method).toBe('whatsapp_link');
    expect(shared.body.data.shareUrl).toContain('/reward/');
    expect((await w.staff.post(`${w.base}/rewards/${id}/shared`, { method: 'sms' })).status).toBe(
      422,
    );
    const detail = (await w.staff.get(`${w.base}/rewards/${id}`)).body.data;
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['reward_issued_auto', 'reward_shared_manually']),
    );
  });

  it('lets the owner issue a reward for an incident that was denied, once', async () => {
    const w = await newWorld();
    const rule = await addRule(w);
    await submit(w, { rating: 1, ua: 'Dev' });
    await submit(w, { rating: 1, ua: 'Dev' }); // cooldown -> no_reward incident
    const inc = (await Incident.findOne({ status: 'no_reward' }).lean())!;
    expect((await w.staff.post(`${w.base}/incidents/${inc._id}/issue`, {})).status).toBe(403);
    const issued = await w.owner.post(`${w.base}/incidents/${inc._id}/issue`, { ruleId: rule.id });
    expect(issued.status).toBe(201);
    expect(issued.body.data.status).toBe('issued');
    expect(
      (await w.owner.post(`${w.base}/incidents/${inc._id}/issue`, { ruleId: rule.id })).status,
    ).toBe(409);
    expect((await Incident.findById(inc._id).lean())!.status).toBe('reward_issued');
    const list = await w.staff.get(`${w.base}/incidents?status=reward_issued`);
    expect(list.body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('resolves incidents (owner only) and lists with pagination and filters', async () => {
    const w = await newWorld();
    await addRule(w);
    for (let i = 0; i < 3; i++) await submit(w, { rating: 1, ua: `U${i}` });
    const page = await w.owner.get(`${w.base}/incidents?pageSize=2`);
    expect(page.body.pagination).toMatchObject({ total: 3, totalPages: 2 });
    const id = page.body.data[0].id;
    expect((await w.staff.post(`${w.base}/incidents/${id}/resolve`, {})).status).toBe(403);
    expect(
      (await w.owner.post(`${w.base}/incidents/${id}/resolve`, { note: 'called back' })).body.data
        .status,
    ).toBe('resolved');
  });

  it('lists and searches rewards, hiding other tenants', async () => {
    const w = await newWorld();
    const other = await newWorld('Other');
    await addRule(w);
    await addRule(other);
    await submit(w, { rating: 1, phone: '+14155550123', ua: 'A' });
    await submit(w, { rating: 1, ua: 'B' });
    await submit(other, { rating: 1, ua: 'A' });
    const all = await w.staff.get(`${w.base}/rewards`);
    expect(all.body.pagination.total).toBe(2);
    const code = all.body.data[0].code as string;
    expect(
      (await w.staff.get(`${w.base}/rewards?search=${code.slice(4, 8)}`)).body.data.length,
    ).toBeGreaterThanOrEqual(1);
    expect((await w.staff.get(`${w.base}/rewards?status=redeemed`)).body.pagination.total).toBe(0);
    expect((await w.staff.get(`${w.base}/rewards?status=bogus`)).status).toBe(422);
    const foreign = (await Reward.findOne({ businessId: other.businessId }).lean())!._id;
    expect((await w.owner.get(`${w.base}/rewards/${foreign}`)).status).toBe(404);
    expect((await w.owner.post(`${w.base}/rewards/${foreign}/cancel`, {})).status).toBe(404);
  });
});

describe('customer reward card', () => {
  it('shows the card via a signed link only, hiding the code until approved', async () => {
    const w = await newWorld();
    await addRule(w, { mode: 'approval', terms: 'One per table.' });
    const r = (await submit(w, { rating: 1 })).body.data.reward;
    const pending = await request(app).get(`/api/v1/public/rewards/${r.token}`);
    expect(pending.status).toBe(200);
    expect(pending.body.data.reward).toMatchObject({
      status: 'pending_approval',
      code: null,
      terms: 'One per table.',
    });
    expect(pending.body.data.business.name).toBe('Harbor Cafe');
    expect(
      (await request(app).get(`/api/v1/public/rewards/${r.token.slice(0, -3)}abc`)).status,
    ).toBe(404);
    expect((await request(app).get('/api/v1/public/rewards/nope')).status).toBe(404);
    await Business.updateOne({ _id: w.businessId }, { status: 'disabled' });
    expect((await request(app).get(`/api/v1/public/rewards/${r.token}`)).status).toBe(404);
  });

  it('shows redeemed and expired status to the customer', async () => {
    const w = await newWorld();
    await addRule(w);
    const r = (await submit(w, { rating: 1 })).body.data.reward;
    await w.staff.post(`${w.base}/rewards/redeem`, { code: r.code, requestId: randomUUID() });
    expect(
      (await request(app).get(`/api/v1/public/rewards/${r.token}`)).body.data.reward.status,
    ).toBe('redeemed');
    const w2 = await newWorld();
    await addRule(w2);
    const r2 = (await submit(w2, { rating: 1 })).body.data.reward;
    await Reward.updateOne({ code: r2.code }, { expiresAt: new Date(Date.now() - 1) });
    expect(
      (await request(app).get(`/api/v1/public/rewards/${r2.token}`)).body.data.reward.status,
    ).toBe('expired');
  });
});

describe('rewards dashboard', () => {
  it('reports exact counts, redemption rate and discount cost without claiming revenue', async () => {
    const w = await newWorld();
    await addRule(w, { cooldownDays: 0, discountValue: 10 });
    const codes: string[] = [];
    for (let i = 0; i < 4; i++)
      codes.push((await submit(w, { rating: 1, ua: `S${i}` })).body.data.reward.code);
    await w.staff.post(`${w.base}/rewards/redeem`, {
      code: codes[0],
      requestId: 'req-aaaaaaaa',
      orderTotal: 50,
    });
    await w.staff.post(`${w.base}/rewards/redeem`, {
      code: codes[1],
      requestId: 'req-bbbbbbbb',
      orderTotal: 30,
    });
    await w.staff.post(`${w.base}/rewards/redeem`, { code: codes[2], requestId: 'req-cccccccc' });
    await Reward.updateOne({ code: codes[3] }, { expiresAt: new Date(Date.now() - 1000) });
    const d = (await w.owner.get(`${w.base}/rewards/summary?days=7`)).body.data;
    expect(d.totals).toMatchObject({
      incidents: 4,
      issued: 4,
      redeemed: 3,
      expired: 1,
      active: 0,
      redemptionRate: 75,
    });
    expect(d.cost.byCurrency).toEqual([{ currency: 'USD', amount: 8, redemptions: 2 }]);
    expect(d.cost.redemptionsWithoutTotal).toBe(1);
    expect(d.trend).toHaveLength(7);
    expect(d.trend[6]).toMatchObject({ incidents: 4, issued: 4, redeemed: 3 });
    expect(JSON.stringify(d)).not.toMatch(/revenue/i);
  });

  it('is empty for a new business and isolated per tenant', async () => {
    const a = await newWorld();
    const b = await newWorld('Other');
    await addRule(a);
    await submit(a, { rating: 1 });
    const d = (await b.owner.get(`${b.base}/rewards/summary`)).body.data;
    expect(d.totals).toMatchObject({ incidents: 0, issued: 0, redeemed: 0, redemptionRate: null });
    expect((await b.owner.get(`${a.base}/rewards/summary`)).status).toBe(403);
  });
});
