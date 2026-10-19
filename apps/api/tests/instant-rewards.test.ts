import { createInstantRewardSchema } from '../src/modules/instant-rewards/instant-reward.schemas';
import { deriveToken } from '../src/modules/instant-rewards/instant-reward.email';
import { EmailDeliveryEvent } from '../src/modules/email/email.model';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID, createHmac } from 'node:crypto';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { InstantRewardsService } from '../src/modules/instant-rewards/instant-reward.service';
import {
  InstantReward,
  InstantRewardEvent,
} from '../src/modules/instant-rewards/instant-reward.model';
import type { RewardEmail } from '../src/modules/instant-rewards/instant-reward.email';
import { User } from '../src/modules/auth/user.model';
import { signAccessToken } from '../src/modules/auth/tokens';
import { AppError } from '../src/shared/errors';
const emails: RewardEmail[] = [];
const mailer = {
  send: vi.fn(async (email: RewardEmail) => {
    emails.push(email);
    return { id: randomUUID() };
  }),
};
const service = new InstantRewardsService(mailer);
const app = createApp(service);
const base = '/api/v1/instant-rewards';
let seq = 0;
async function client(role: 'USER' | 'SUPER_ADMIN' = 'USER', email?: string) {
  const user = await User.create({
    fullName: 'Reward user',
    emailLowercase: email ?? `instant-${++seq}@example.com`,
    passwordHash: 'never-log',
    platformRole: role,
  });
  const cookie = `gdv_at=${signAccessToken(String(user._id))}; gdv_csrf=csrf`;
  return {
    user,
    get: (path: string) => request(app).get(path).set('Cookie', cookie),
    post: (path: string, body: object) =>
      request(app).post(path).set('Cookie', cookie).set('X-CSRF-Token', 'csrf').send(body),
    patch: (path: string, body: object) =>
      request(app).patch(path).set('Cookie', cookie).set('X-CSRF-Token', 'csrf').send(body),
  };
}
const payload = (email: string, extra: object = {}) => ({
  recipientEmail: email,
  title: 'Thank you',
  rewardType: 'PERCENT_DISCOUNT',
  rewardValue: 15,
  promoCode: 'THANKYOU',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  verificationRequired: false,
  createRequestId: randomUUID(),
  sendImmediately: true,
  ...extra,
});
const operation = () => ({ requestId: randomUUID(), confirm: true });
function token(index = emails.length - 1, verify = false) {
  return new URL(
    emails[index]!.text.split(
      verify ? 'Verify reward ownership: ' : 'View / Claim Reward: ',
    )[1]!.split('\n')[0]!,
  ).hash.split('=')[1]!;
}
async function issued(extra: object = {}) {
  const admin = await client('SUPER_ADMIN');
  const recipient = await client();
  const body = payload(recipient.user.emailLowercase, extra);
  const result = await admin.post(`${base}/admin`, body);
  expect(result.status).toBe(201);
  return { admin, recipient, body, reward: result.body.data as { id: string; status: string } };
}
beforeAll(async () => {
  env.INSTANT_REWARDS_TOKEN_SECRET = 't'.repeat(48);
  env.RESEND_WEBHOOK_SECRET =
    'whsec_' + Buffer.from('webhook-signing-secret-32-characters').toString('base64');
  await mongoose.connect(process.env['MONGODB_URI']!);
  await Promise.all([InstantReward.init(), InstantRewardEvent.init()]);
});
beforeEach(async () => {
  emails.length = 0;
  mailer.send.mockClear();
  await Promise.all([
    User.deleteMany({}),
    InstantReward.deleteMany({}),
    InstantRewardEvent.deleteMany({}),
    EmailDeliveryEvent.deleteMany({}),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
});
describe('Instant Rewards API', () => {
  it('creates and safely replays creation, sends only to the normalized recipient, hides secrets', async () => {
    const { admin, recipient, body, reward } = await issued();
    expect(reward.status).toBe('SENT');
    expect(emails[0]!.to).toBe(recipient.user.emailLowercase);
    const replay = await admin.post(`${base}/admin`, body);
    expect(replay.status).toBe(200);
    expect(emails).toHaveLength(1);
    expect(await InstantReward.countDocuments()).toBe(1);
    const stored = await InstantReward.findById(reward.id).lean();
    expect(stored!.claimTokenHash).not.toBe(token());
    expect(JSON.stringify(stored)).not.toContain(token());
    expect(JSON.stringify(replay.body)).not.toMatch(/TokenHash|nonce|passwordHash/);
    expect((await admin.post(`${base}/admin`, { ...body, title: 'changed' })).body.error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });
  it('rejects anonymous, ordinary users, mass assignment, and missing CSRF', async () => {
    const user = await client();
    expect(
      (await request(app).post(`${base}/admin`).send(payload(user.user.emailLowercase))).status,
    ).toBe(403);
    expect((await user.post(`${base}/admin`, payload(user.user.emailLowercase))).status).toBe(403);
    const admin = await client('SUPER_ADMIN');
    expect(
      (
        await admin.post(`${base}/admin`, {
          ...payload(user.user.emailLowercase),
          status: 'CLAIMED',
        })
      ).status,
    ).toBe(422);
  });
  it('honors explicit delegation without granting general admin and revokes it immediately', async () => {
    const root = await client('SUPER_ADMIN');
    const delegated = await client();
    await User.updateOne(
      { _id: delegated.user._id },
      { $addToSet: { permissions: 'instant_rewards:manage' } },
    );
    expect((await delegated.get(`${base}/admin`)).status).toBe(200);
    expect((await delegated.get('/api/v1/admin/users')).status).toBe(403);
    expect(
      (
        await root.post(`/api/v1/admin/users/${delegated.user._id}/instant-reward-access`, {
          enabled: false,
          confirm: true,
        })
      ).status,
    ).toBe(200);
    expect((await delegated.get(`${base}/admin`)).status).toBe(401);
  });
  it('verifies with a separate one-use email challenge and claims by established proof', async () => {
    const { recipient, reward } = await issued({ verificationRequired: true });
    const claimToken = token();
    expect(
      (await recipient.post(`${base}/claim`, { token: claimToken, requestId: randomUUID() })).body
        .error.code,
    ).toBe('REWARD_VERIFICATION_REQUIRED');
    expect(
      (
        await recipient.post(`${base}/request-verification`, {
          token: claimToken,
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(200);
    const verification = token(1, true);
    expect((await recipient.post(`${base}/verify`, { token: verification })).body.data.status).toBe(
      'VERIFIED',
    );
    expect((await recipient.post(`${base}/verify`, { token: verification })).body.error.code).toBe(
      'INVALID_REWARD_TOKEN',
    );
    expect(
      (await recipient.post(`${base}/claim`, { rewardId: reward.id, requestId: randomUUID() })).body
        .data.status,
    ).toBe('CLAIMED');
  });
  it('denies wrong recipients, foreign list filters, and email changes', async () => {
    const { recipient, reward } = await issued({ verificationRequired: true });
    const other = await client();
    const t = token();
    for (const action of ['view', 'claim', 'request-verification']) {
      const body = action === 'view' ? { token: t } : { token: t, requestId: randomUUID() };
      expect((await other.post(`${base}/${action}`, body)).body.error.code).toBe(
        'REWARD_NOT_OWNER',
      );
    }
    expect(
      (await other.get(`${base}/mine?recipientUserId=${recipient.user._id}`)).body.data,
    ).toHaveLength(0);
    await User.updateOne({ _id: recipient.user._id }, { emailLowercase: 'changed@example.com' });
    expect(
      (await recipient.post(`${base}/claim`, { token: t, requestId: randomUUID() })).body.error
        .code,
    ).toBe('REWARD_NOT_OWNER');
    expect(
      (await other.post(`${base}/${reward.id}/request-link`, operation())).body.error.code,
    ).toBe('REWARD_NOT_OWNER');
  });
  it('claims once, replays the same receipt, rejects new requests and never returns promo before claim', async () => {
    const { recipient } = await issued();
    const t = token();
    expect((await recipient.post(`${base}/view`, { token: t })).body.data.promoCode).toBeNull();
    const body = { token: t, requestId: randomUUID() };
    const first = await recipient.post(`${base}/claim`, body);
    expect(first.body.data.promoCode).toBe('THANKYOU');
    const replay = await recipient.post(`${base}/claim`, body);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.data.claimReceiptId).toBe(first.body.data.claimReceiptId);
    expect(
      (await recipient.post(`${base}/claim`, { ...body, requestId: randomUUID() })).body.error.code,
    ).toBe('REWARD_ALREADY_CLAIMED');
    expect(await InstantRewardEvent.countDocuments({ action: 'REWARD_CLAIMED' })).toBe(1);
  });
  it('concurrent clicks produce one receipt and one claim event', async () => {
    const { recipient } = await issued();
    const body = { token: token(), requestId: randomUUID() };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => recipient.post(`${base}/claim`, body)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.claimReceiptId)).size).toBe(1);
    expect(await InstantRewardEvent.countDocuments({ action: 'REWARD_CLAIMED' })).toBe(1);
  });
  it('enforces expiration at the server and records expiry', async () => {
    const { recipient, reward, admin } = await issued();
    const t = token();
    await InstantReward.updateOne({ _id: reward.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect(
      (await recipient.post(`${base}/claim`, { token: t, requestId: randomUUID() })).body.error
        .code,
    ).toBe('REWARD_EXPIRED');
    expect((await admin.get(`${base}/admin/${reward.id}`)).body.data.status).toBe('EXPIRED');
    expect(await InstantRewardEvent.countDocuments({ action: 'REWARD_EXPIRED' })).toBe(1);
  });
  it('disables and re-enables with history preserved, permanently revokes', async () => {
    const { recipient, reward, admin } = await issued();
    const t = token();
    expect(
      (await admin.post(`${base}/admin/${reward.id}/disable`, { confirm: true })).body.data.status,
    ).toBe('DISABLED');
    expect(
      (await recipient.post(`${base}/claim`, { token: t, requestId: randomUUID() })).body.error
        .code,
    ).toBe('REWARD_DISABLED');
    const enabled = await admin.post(`${base}/admin/${reward.id}/enable`, { confirm: true });
    expect(enabled.body.data.status).toBe('SENT');
    expect(enabled.body.data.disabledAt).toBeTruthy();
    expect(
      (await recipient.post(`${base}/claim`, { token: t, requestId: randomUUID() })).status,
    ).toBe(200);
    expect(
      (await admin.post(`${base}/admin/${reward.id}/revoke`, { confirm: true })).body.error.code,
    ).toBe('REWARD_ALREADY_CLAIMED');
    const next = await issued();
    await next.admin.post(`${base}/admin/${next.reward.id}/revoke`, {
      confirm: true,
      reason: 'Cancelled',
    });
    expect(
      (await next.recipient.post(`${base}/claim`, { token: token(), requestId: randomUUID() })).body
        .error.code,
    ).toBe('REWARD_REVOKED');
    expect(
      (await next.admin.post(`${base}/admin/${next.reward.id}/enable`, { confirm: true })).body
        .error.code,
    ).toBe('REWARD_REVOKED');
  });
  it('rejects invalid/expired tokens and replaces old links on resend without duplicating rewards', async () => {
    const { recipient, reward, admin } = await issued();
    const old = token();
    expect((await recipient.post(`${base}/view`, { token: 'x'.repeat(43) })).body.error.code).toBe(
      'INVALID_REWARD_TOKEN',
    );
    await InstantReward.updateOne(
      { _id: reward.id },
      { claimTokenExpiresAt: new Date(Date.now() - 1) },
    );
    expect((await recipient.post(`${base}/view`, { token: old })).body.error.code).toBe(
      'REWARD_TOKEN_EXPIRED',
    );
    const op = operation();
    expect((await admin.post(`${base}/admin/${reward.id}/resend`, op)).status).toBe(200);
    expect((await recipient.post(`${base}/view`, { token: old })).body.error.code).toBe(
      'INVALID_REWARD_TOKEN',
    );
    expect((await recipient.post(`${base}/view`, { token: token() })).status).toBe(200);
    await admin.post(`${base}/admin/${reward.id}/resend`, op);
    expect(emails).toHaveLength(2);
    expect(await InstantReward.countDocuments()).toBe(1);
  });
  it('rejects expired verification tokens and deactivated accounts', async () => {
    const { recipient, reward } = await issued({ verificationRequired: true });
    await recipient.post(`${base}/request-verification`, {
      token: token(),
      requestId: randomUUID(),
    });
    const t = token(1, true);
    await InstantReward.updateOne(
      { _id: reward.id },
      { verificationTokenExpiresAt: new Date(Date.now() - 1) },
    );
    expect((await recipient.post(`${base}/verify`, { token: t })).body.error.code).toBe(
      'REWARD_TOKEN_EXPIRED',
    );
    await User.updateOne({ _id: recipient.user._id }, { status: 'disabled' });
    expect((await recipient.get(`${base}/mine`)).status).toBe(401);
  });
  it('supports later registration and enforces ownership binding', async () => {
    const admin = await client('SUPER_ADMIN');
    const email = 'new-recipient@example.com';
    const result = await admin.post(`${base}/admin`, payload(email));
    const recipient = await client('USER', email);
    expect(
      (await recipient.post(`${base}/claim`, { token: token(), requestId: randomUUID() })).status,
    ).toBe(200);
    expect(String((await InstantReward.findById(result.body.data.id))!.recipientUserId)).toBe(
      String(recipient.user._id),
    );
  });
  it('records definitive email failure, retries with a new operation without duplicate creation', async () => {
    mailer.send.mockRejectedValueOnce(new AppError(503, 'EMAIL_SEND_FAILED', 'Provider refused'));
    const { admin, reward } = await issued();
    expect(reward.status).toBe('FAILED');
    expect(await InstantRewardEvent.countDocuments({ action: 'EMAIL_FAILED' })).toBe(1);
    expect(
      (await admin.post(`${base}/admin/${reward.id}/resend`, operation())).body.data.status,
    ).toBe('SENT');
    expect(await InstantReward.countDocuments()).toBe(1);
  });
  it('retries uncertain sends with exactly the same provider key and body', async () => {
    mailer.send.mockRejectedValueOnce(new AppError(503, 'EMAIL_SEND_UNCERTAIN', 'Timeout'));
    const { admin, body, reward } = await issued();
    const sent = mailer.send.mock.calls[0]![0];
    expect(
      (
        await admin.post(`${base}/admin/${reward.id}/send`, {
          requestId: body.createRequestId,
          confirm: true,
        })
      ).status,
    ).toBe(200);
    expect(mailer.send.mock.calls[1]![0]).toEqual(sent);
  });
  it('filters, returns summary/audit, and only edits unsent drafts', async () => {
    const { admin, reward, recipient } = await issued();
    expect(
      (
        await admin.get(
          `${base}/admin?search=${recipient.user.emailLowercase}&status=SENT&rewardType=PERCENT_DISCOUNT&enabled=true`,
        )
      ).body.pagination.total,
    ).toBe(1);
    expect((await admin.get(`${base}/admin?status=CLAIMED`)).body.data).toHaveLength(0);
    expect((await admin.get(`${base}/admin/summary`)).body.data.SENT).toBe(1);
    const history = await admin.get(`${base}/admin/${reward.id}/audit`);
    expect(history.body.data.map((e: { action: string }) => e.action)).toContain('EMAIL_SENT');
    const draft = await admin.post(
      `${base}/admin`,
      payload(recipient.user.emailLowercase, { sendImmediately: false }),
    );
    const edit = {
      ...payload(recipient.user.emailLowercase),
      expectedRevision: 1,
      title: 'Edited',
    };
    const { createRequestId: unused, sendImmediately: unused2, ...fields } = edit;
    void unused;
    void unused2;
    expect((await admin.patch(`${base}/admin/${draft.body.data.id}`, fields)).body.data.title).toBe(
      'Edited',
    );
    expect((await admin.patch(`${base}/admin/${reward.id}`, fields)).status).toBe(409);
  });
  it('accepts only signed delivery webhooks, deduplicates events and preserves terminal states', async () => {
    const { reward, recipient, admin } = await issued();
    const stored = await InstantReward.findById(reward.id).lean();
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: { email_id: stored!.delivery!.providerMessageId },
    });
    const id = randomUUID();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', Buffer.from(env.RESEND_WEBHOOK_SECRET!.slice(6), 'base64'))
      .update(`${id}.${ts}.${body}`)
      .digest('base64');
    const url = '/api/v1/webhooks/instant-rewards/email';
    expect(
      (await request(app).post(url).set('Content-Type', 'application/json').send(body)).status,
    ).toBe(401);
    const webhook = () =>
      request(app)
        .post(url)
        .set('Content-Type', 'application/json')
        .set('svix-id', id)
        .set('svix-timestamp', ts)
        .set('svix-signature', `v1,${sig}`)
        .send(body);
    expect((await webhook()).status).toBe(200);
    expect((await InstantReward.findById(reward.id))!.status).toBe('DELIVERED');
    await admin.post(`${base}/admin/${reward.id}/resend`, operation());
    await service.deliveryEvent(
      stored!.delivery!.providerMessageId!,
      'email.delivered',
      randomUUID(),
      new Date(),
    );
    expect((await InstantReward.findById(reward.id))!.status).toBe('SENT');
    await recipient.post(`${base}/claim`, { token: token(), requestId: randomUUID() });
    await webhook();
    expect((await InstantReward.findById(reward.id))!.status).toBe('CLAIMED');
    expect(await InstantRewardEvent.countDocuments({ id: `provider:${id}` })).toBe(1);
  });
  it('claim racing disable never leaves a disabled reward claimed', async () => {
    const { admin, recipient, reward } = await issued();
    const results = await Promise.all([
      recipient.post(`${base}/claim`, { token: token(), requestId: randomUUID() }),
      admin.post(`${base}/admin/${reward.id}/disable`, { confirm: true }),
    ]);
    const stored = await InstantReward.findById(reward.id);
    expect(['CLAIMED', 'DISABLED']).toContain(stored!.status);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
  it('concurrent same-operation sends reconstruct identical provider payloads', async () => {
    const { admin, recipient } = await issued();
    const draft = await admin.post(
      `${base}/admin`,
      payload(recipient.user.emailLowercase, { sendImmediately: false }),
    );
    const op = operation();
    mailer.send.mockClear();
    const results = await Promise.all([
      admin.post(`${base}/admin/${draft.body.data.id}/send`, op),
      admin.post(`${base}/admin/${draft.body.data.id}/send`, op),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const calls = mailer.send.mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toEqual(calls[0]);
  });
  it('retains atomic audit outbox on history failure and drains it on later reads', async () => {
    const { admin, recipient } = await issued();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const write = vi
      .spyOn(InstantRewardEvent, 'bulkWrite')
      .mockRejectedValueOnce(new Error('Event store unavailable'));
    const response = await admin.post(
      `${base}/admin`,
      payload(recipient.user.emailLowercase, { sendImmediately: false }),
    );
    expect(response.status).toBe(201);
    const stored = await InstantReward.findById(response.body.data.id).lean();
    expect(stored!.pendingEvents).toHaveLength(1);
    write.mockRestore();
    await admin.get(`${base}/admin/${response.body.data.id}`);
    expect((await InstantReward.findById(response.body.data.id))!.pendingEvents).toHaveLength(0);
    expect(
      await InstantRewardEvent.countDocuments({
        rewardId: response.body.data.id,
        action: 'REWARD_CREATED',
      }),
    ).toBe(1);
    warning.mockRestore();
  });
  it('prevents email-only account impersonation and reuse of a deleted bound recipient address', async () => {
    const { admin, recipient, reward } = await issued();
    expect(
      (await recipient.post(`${base}/claim`, { rewardId: reward.id, requestId: randomUUID() })).body
        .error.code,
    ).toBe('INVALID_REWARD_TOKEN');
    const t = token();
    await User.deleteOne({ _id: recipient.user._id });
    const replacement = await client('USER', recipient.user.emailLowercase);
    expect(
      (await replacement.post(`${base}/claim`, { token: t, requestId: randomUUID() })).body.error
        .code,
    ).toBe('REWARD_NOT_OWNER');
    expect((await admin.get(`${base}/admin/${reward.id}`)).body.data.status).toBe('SENT');
  });
  it('rejects unsafe metadata and ignores browser-supplied permission fields', async () => {
    const admin = await client('SUPER_ADMIN');
    const recipient = await client();
    expect(
      (
        await admin.post(
          `${base}/admin`,
          payload(recipient.user.emailLowercase, { metadata: { $bad: 'unsafe' } }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await admin.post(
          `${base}/admin`,
          payload(recipient.user.emailLowercase, { permissions: ['instant_rewards:manage'] }),
        )
      ).status,
    ).toBe(422);
  });
  it('records signed non-reward complaints once on the shared webhook without affecting rewards', async () => {
    await issued();
    const body = JSON.stringify({
      type: 'email.complained',
      created_at: new Date().toISOString(),
      data: { email_id: 'notification-provider-id' },
    });
    const id = randomUUID();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', Buffer.from(env.RESEND_WEBHOOK_SECRET!.slice(6), 'base64'))
      .update(`${id}.${ts}.${body}`)
      .digest('base64');
    const send = () =>
      request(app)
        .post('/api/v1/webhooks/resend')
        .set('Content-Type', 'application/json')
        .set('svix-id', id)
        .set('svix-timestamp', ts)
        .set('svix-signature', `v1,${sig}`)
        .send(body);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(await EmailDeliveryEvent.countDocuments({ eventId: id, type: 'email.complained' })).toBe(
      1,
    );
    expect((await InstantReward.findOne())!.status).toBe('SENT');
  });
  it('reconciles a delivery callback received before acceptance was persisted', async () => {
    const providerId = randomUUID();
    await EmailDeliveryEvent.create({
      eventId: randomUUID(),
      providerMessageId: providerId,
      type: 'email.delivered',
      occurredAt: new Date(),
    });
    mailer.send.mockResolvedValueOnce({ id: providerId });
    const { reward } = await issued();
    expect(reward.status).toBe('DELIVERED');
    expect(await InstantRewardEvent.countDocuments({ action: 'EMAIL_DELIVERED' })).toBe(1);
    const another = await issued();
    const stored = await InstantReward.findById(another.reward.id).lean();
    await EmailDeliveryEvent.create({
      eventId: randomUUID(),
      providerMessageId: stored!.delivery!.providerMessageId!,
      type: 'email.delivered',
      occurredAt: new Date(),
    });
    const replay = await another.admin.post(`${base}/admin/${another.reward.id}/send`, {
      requestId: another.body.createRequestId,
      confirm: true,
    });
    expect(replay.body.data.status).toBe('DELIVERED');
  });
  it('blocked test emails never mark rewards sent/delivered/verified/claimed', async () => {
    const original = {
      EMAIL_ENABLED: env.EMAIL_ENABLED,
      EMAIL_TEST_MODE: env.EMAIL_TEST_MODE,
      RESEND_TEST_EMAIL: env.RESEND_TEST_EMAIL,
    };
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      env.EMAIL_ENABLED = true;
      env.EMAIL_TEST_MODE = true;
      env.RESEND_TEST_EMAIL = 'resend-account@example.com';
      const admin = await client('SUPER_ADMIN');
      const recipient = await client();
      const real = new InstantRewardsService();
      const result = await real.create(
        { id: String(admin.user._id), type: 'ADMIN' },
        createInstantRewardSchema.parse(payload(recipient.user.emailLowercase)),
      );
      expect(result.sendError).toBe('EMAIL_TEST_RECIPIENT_BLOCKED');
      expect(result.reward.status).toBe('FAILED');
      expect(result.reward.sentAt).toBeNull();
      expect(result.reward.deliveredAt).toBeNull();
      expect(result.reward.verifiedAt).toBeNull();
      expect(result.reward.claimedAt).toBeNull();
      const stored = await InstantReward.findById(result.reward.id).lean();
      const token = deriveToken(stored!.delivery!.nonce!, 'claim', stored!.delivery!.requestId!);
      await expect(
        real.claim({ token, requestId: randomUUID() }, String(recipient.user._id)),
      ).rejects.toMatchObject({ code: 'REWARD_INVALID_STATE' });
      expect(await InstantRewardEvent.countDocuments({ action: 'REWARD_CLAIMED' })).toBe(0);
      expect(await InstantRewardEvent.countDocuments({ action: 'EMAIL_FAILED' })).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      Object.assign(env, original);
      vi.unstubAllGlobals();
    }
  });
});
