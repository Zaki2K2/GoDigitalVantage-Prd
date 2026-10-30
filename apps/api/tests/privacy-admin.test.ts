import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { User } from '../src/modules/auth/user.model';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { hashPassword } from '../src/modules/auth/password';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { Contact } from '../src/modules/contacts/contact.model';
import { Response as FeedbackResponse } from '../src/modules/responses/response.model';
import { Reward } from '../src/modules/rewards/reward.model';
import { Questionnaire } from '../src/modules/questionnaires/questionnaire.model';
import { AdminAudit } from '../src/modules/admin/admin.model';
import { AdminReauth, SupportAccessLog, SupportGrant } from '../src/modules/admin/support.model';
import { activeGrant, seedSession } from './support-helpers';

const app = createApp();
const PASSWORD = 'test-secure-password-123';
const PII = {
  name: 'Zelda Customerson',
  email: 'zelda.customer@private-example.test',
  phone: '+14155550123',
  answer: 'The waiter was rude about my allergy',
};
let passwordHash = '';
let seq = 0;

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  passwordHash = await hashPassword(PASSWORD);
});
afterAll(async () => {
  await mongoose.disconnect();
});
beforeEach(async () => {
  const models = [
    User,
    RefreshToken,
    Business,
    BusinessMembership,
    Contact,
    FeedbackResponse,
    Reward,
    Questionnaire,
    AdminAudit,
    SupportGrant,
    AdminReauth,
  ];
  await Promise.all(models.map((m) => (m as typeof User).deleteMany({})));
  // The access log is append-only through the model; tests clear the raw collection.
  await mongoose.connection.collection('support_access_log').deleteMany({});
});

async function client(
  admin = false,
  permissions: ('support:emergency' | 'instant_rewards:manage')[] = [],
) {
  const user = await User.create({
    fullName: admin ? 'Platform Admin' : 'Business Owner',
    emailLowercase: `privacy-${++seq}@example.test`,
    passwordHash,
    platformRole: admin ? 'SUPER_ADMIN' : 'USER',
    permissions,
  });
  return session(user);
}
/** One browser or device: its own cookie jar and refresh-token family. */
async function session(user: InstanceType<typeof User>) {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  const login = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', csrf)
    .send({ email: user.emailLowercase, password: PASSWORD });
  expect(login.status).toBe(200);
  return {
    user,
    id: String(user._id),
    get: (url: string) => agent.get(url),
    post: (url: string, body: object = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    patch: (url: string, body: object) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    reauth: async () => {
      const r = await agent
        .post('/api/v1/admin/reauth')
        .set('X-CSRF-Token', csrf)
        .send({ password: PASSWORD });
      expect(r.status).toBe(200);
    },
    agent,
  };
}
type Client = Awaited<ReturnType<typeof client>>;

async function tenant(owner: Client, name = 'Privacy Cafe') {
  const b = await Business.create({
    ownerUserId: owner.user._id,
    createRequestId: randomUUID(),
    name,
    category: 'Cafe',
    timezone: 'UTC',
    slug: `privacy-${randomUUID()}`,
  });
  await BusinessMembership.create({ businessId: b._id, userId: owner.user._id, role: 'owner' });
  const form = await Questionnaire.create({
    businessId: b._id,
    draft: { title: 'Feedback', description: null, questions: [] },
  });
  const contact = await Contact.create({
    businessId: b._id,
    fullName: PII.name,
    emailLowercase: PII.email,
    phoneE164: PII.phone,
    firstResponseAt: new Date(),
    lastResponseAt: new Date(),
  });
  await FeedbackResponse.create({
    businessId: b._id,
    questionnaireId: form._id,
    questionnaireVersion: 1,
    contactId: contact._id,
    answers: [
      { questionId: 'q1', type: 'long_text', label: 'Comments', required: false, text: PII.answer },
    ],
    rating: 2,
    idempotencyKey: randomUUID(),
    submittedAt: new Date(),
  });
  const reward = await Reward.create({
    businessId: b._id,
    ruleId: new mongoose.Types.ObjectId(),
    ruleName: 'Recovery',
    responseId: new mongoose.Types.ObjectId(),
    contactId: contact._id,
    code: 'GDV-SECRETCODE',
    status: 'pending_approval',
    discountType: 'percent',
    discountValue: 10,
    currency: 'USD',
    validityDays: 7,
    identityHash: 'hash-xyz',
  });
  return { b, form, contact, reward };
}
const leaks = (body: unknown) =>
  JSON.stringify(body).match(
    /Zelda|zelda\.customer|private-example|\+14155550123|waiter was rude|SECRETCODE|hash-xyz/,
  );

describe('default admin endpoints never expose tenant customer data', () => {
  it('refuses responses, contacts and promotions routes with audited 403s', async () => {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const paths = [
      '/api/v1/admin/contacts',
      `/api/v1/admin/contacts/${t.contact._id}`,
      '/api/v1/admin/responses',
      `/api/v1/admin/responses/${new mongoose.Types.ObjectId()}`,
      '/api/v1/admin/promotions',
      `/api/v1/admin/promotions/${t.reward._id}`,
      `/api/v1/admin/contacts?search=${encodeURIComponent(PII.email)}&pageSize=100`,
      `/api/v1/admin/responses?businessId=${t.b._id}&sort=submittedAt`,
    ];
    for (const path of paths) {
      const res = await admin.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('CUSTOMER_DATA_RESTRICTED');
      expect(leaks(res.body)).toBeNull();
    }
    const approve = await admin.post(`/api/v1/admin/promotions/${t.reward._id}/approve`, {
      confirm: true,
    });
    expect(approve.status).toBe(403);
    expect((await Reward.findById(t.reward._id).lean())?.status).toBe('pending_approval');
    const log = await SupportAccessLog.find({
      event: 'RESTRICTED_ROUTE',
      outcome: 'denied',
    }).lean();
    expect(log).toHaveLength(paths.length + 1);
    // Audit stores route templates only: no query string, search term or ids.
    expect(JSON.stringify(log)).not.toMatch(/private-example|zelda|pageSize|search=/i);
  });

  it('search and filters never reach private customer records', async () => {
    const admin = await client(true);
    const owner = await client();
    await tenant(owner);
    for (const term of [
      'Zelda',
      'private-example',
      '4155550123',
      'rude',
      'SECRETCODE',
      'Privacy',
    ]) {
      const res = await admin.get(`/api/v1/admin/search?search=${term}`);
      expect(res.status).toBe(200);
      expect(leaks(res.body), term).toBeNull();
      const resources = (res.body.data as { resource: string }[]).map((g) => g.resource);
      expect(resources).toEqual(['businesses', 'users', 'forms']);
    }
    const f = await admin.get('/api/v1/admin/forms?rating=2&search=rude');
    expect(f.status).toBe(200);
    expect(f.body.data).toHaveLength(0);
    expect(leaks((await admin.get('/api/v1/admin/forms')).body)).toBeNull();
  });

  it('business and activity views expose only aggregate counts and redacted audit data', async () => {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const detail = await admin.get(`/api/v1/admin/businesses/${t.b._id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.counts).toMatchObject({ contacts: 1, responses: 1, rewards: 1 });
    expect(leaks(detail.body)).toBeNull();
    await AdminAudit.create({
      actorUserId: admin.user._id,
      actorName: 'x',
      actorEmail: 'x@example.test',
      businessId: t.b._id,
      entity: 'promotions',
      targetId: t.reward._id,
      action: 'LEGACY',
      before: { status: 'a', email: PII.email, nested: { code: 'GDV-SECRETCODE' } },
      after: { note: PII.answer },
      outcome: 'completed',
    });
    const activity = await admin.get('/api/v1/admin/activity');
    expect(activity.status).toBe(200);
    expect(leaks(activity.body)).toBeNull();
    expect(activity.body.data[0].before.status).toBe('a');
  });

  it('keeps platform capabilities: dashboard, block/unblock, revoke sessions, suspend business', async () => {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const dash = await admin.get('/api/v1/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(leaks(dash.body)).toBeNull();
    const act = `/api/v1/admin/users/${owner.id}/action`;
    expect((await admin.post(act, { action: 'block', confirm: true })).status).toBe(200);
    expect((await owner.get('/api/v1/me')).status).toBe(401);
    expect((await admin.post(act, { action: 'unblock', confirm: true })).status).toBe(200);
    expect((await admin.post(act, { action: 'revoke-sessions', confirm: true })).status).toBe(200);
    const suspend = await admin.post(`/api/v1/admin/businesses/${t.b._id}/state`, {
      state: 'suspended',
      confirm: true,
    });
    expect(suspend.status).toBe(200);
    expect((await Business.findById(t.b._id).lean())?.adminState).toBe('suspended');
    expect((await admin.get('/api/v1/admin/system')).status).toBe(200);
  });

  it('campaign monitoring carries no recipient identifiers', async () => {
    const admin = await client(true);
    const res = await admin.get('/api/v1/admin/campaigns/monitoring');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/contactId|providerMessageId|"email"|"text"/);
  });
});

describe('tenant isolation and ownership remain intact', () => {
  it('Super Admin has no implicit membership; unrelated tenants are refused; owners keep access', async () => {
    const admin = await client(true);
    const ownerA = await client();
    const ownerB = await client();
    const a = await tenant(ownerA, 'A');
    await tenant(ownerB, 'B');
    for (const path of [
      `/api/v1/businesses/${a.b._id}/contacts`,
      `/api/v1/businesses/${a.b._id}/responses`,
      `/api/v1/businesses/${a.b._id}/support-grants`,
    ]) {
      expect((await admin.get(path)).status, path).toBe(403);
    }
    expect((await ownerB.get(`/api/v1/businesses/${a.b._id}/contacts`)).status).toBe(403);
    expect((await ownerB.get(`/api/v1/businesses/${a.b._id}/support-grants`)).status).toBe(403);
    const own = await ownerA.get(`/api/v1/businesses/${a.b._id}/contacts`);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain('zelda.customer');
    expect((await ownerA.get(`/api/v1/businesses/${a.b._id}/responses`)).status).toBe(200);
  });

  it('a non-owner member cannot approve support access', async () => {
    const admin = await client(true);
    const owner = await client();
    const member = await client();
    const t = await tenant(owner);
    await BusinessMembership.create({
      businessId: t.b._id,
      userId: member.user._id,
      role: 'member',
    });
    const g = await admin.post('/api/v1/admin/support-grants', {
      businessId: String(t.b._id),
      ticketRef: 'T-1',
      reason: 'Investigating a broken form',
      scopes: ['responses'],
    });
    expect(g.status).toBe(201);
    const url = `/api/v1/businesses/${t.b._id}/support-grants/${g.body.data.id}/approve`;
    expect((await member.post(url, {})).status).toBe(403);
    expect((await admin.post(url, {})).status).toBe(403);
  });
});

describe('controlled support access', () => {
  async function setup() {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const requested = await admin.post('/api/v1/admin/support-grants', {
      businessId: String(t.b._id),
      ticketRef: 'TICKET-42',
      reason: 'Owner reported missing responses',
      scopes: ['responses', 'rewards'],
      durationMinutes: 30,
    });
    expect(requested.status).toBe(201);
    return { admin, owner, t, grantId: requested.body.data.id as string };
  }

  it('is denied until the owner approves, then read-only, scoped and tenant-bound', async () => {
    const { admin, owner, t, grantId } = await setup();
    const data = `/api/v1/admin/support/${grantId}/responses`;
    const before = await admin.get(data);
    expect(before.status).toBe(403);
    expect(leaks(before.body)).toBeNull();

    const approve = await owner.post(
      `/api/v1/businesses/${t.b._id}/support-grants/${grantId}/approve`,
    );
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('active');

    const ok = await admin.get(data);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveLength(1);
    expect(ok.body.data[0].businessId).toBe(String(t.b._id));
    expect((await admin.get(`/api/v1/admin/support/${grantId}/contacts`)).status).toBe(403);
    await admin.reauth();
    const write = await admin.post(
      `/api/v1/admin/support/${grantId}/rewards/${t.reward._id}/approve`,
      { confirm: true },
    );
    expect(write.status).toBe(403);
    expect((await Reward.findById(t.reward._id).lean())?.status).toBe('pending_approval');
    const other = await client(true);
    expect((await other.get(data)).status).toBe(403);
    const ownerB = await client();
    const b = await tenant(ownerB, 'B');
    const listed = await admin.get(`${data}?businessId=${b.b._id}`);
    expect(
      listed.body.data.every((r: { businessId: string }) => r.businessId === String(t.b._id)),
    ).toBe(true);
  });

  it('expires automatically and is revocable by the business owner', async () => {
    const { admin, owner, t, grantId } = await setup();
    const url = `/api/v1/businesses/${t.b._id}/support-grants/${grantId}`;
    await owner.post(`${url}/approve`);
    expect((await admin.get(`/api/v1/admin/support/${grantId}/responses`)).status).toBe(200);
    await SupportGrant.updateOne({ _id: grantId }, { expiresAt: new Date(Date.now() - 1000) });
    const expired = await admin.get(`/api/v1/admin/support/${grantId}/responses`);
    expect(expired.status).toBe(403);
    expect(leaks(expired.body)).toBeNull();
    expect(
      (await owner.get(`/api/v1/businesses/${t.b._id}/support-grants`)).body.data[0].status,
    ).toBe('expired');

    const second = await admin.post('/api/v1/admin/support-grants', {
      businessId: String(t.b._id),
      ticketRef: 'TICKET-43',
      reason: 'Second investigation window',
      scopes: ['responses'],
    });
    const secondUrl = `/api/v1/businesses/${t.b._id}/support-grants/${second.body.data.id}`;
    await owner.post(`${secondUrl}/approve`);
    const secondData = `/api/v1/admin/support/${second.body.data.id}/responses`;
    expect((await admin.get(secondData)).status).toBe(200);
    expect((await owner.post(`${secondUrl}/revoke`)).status).toBe(200);
    expect((await admin.get(secondData)).status).toBe(403);

    const third = await admin.post('/api/v1/admin/support-grants', {
      businessId: String(t.b._id),
      ticketRef: 'TICKET-44',
      reason: 'Third investigation window',
      scopes: ['responses'],
    });
    const thirdUrl = `/api/v1/businesses/${t.b._id}/support-grants/${third.body.data.id}`;
    expect((await owner.post(`${thirdUrl}/deny`)).status).toBe(200);
    expect((await owner.post(`${thirdUrl}/approve`)).status).toBe(409);
  });

  it('requires owner password for write grants and administrator reauthentication to use them', async () => {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const g = await admin.post('/api/v1/admin/support-grants', {
      businessId: String(t.b._id),
      ticketRef: 'TICKET-W',
      reason: 'Approve a stuck recovery reward',
      scopes: ['rewards'],
      mode: 'write',
    });
    const url = `/api/v1/businesses/${t.b._id}/support-grants/${g.body.data.id}/approve`;
    expect((await owner.post(url)).status).toBe(403);
    expect((await owner.post(url, { password: 'wrong-password-123' })).status).toBe(403);
    expect((await owner.post(url, { password: PASSWORD })).status).toBe(200);

    const act = `/api/v1/admin/support/${g.body.data.id}/rewards/${t.reward._id}/approve`;
    expect((await admin.post(act, { confirm: true })).status).toBe(403);
    const bad = await admin.post('/api/v1/admin/reauth', { password: 'wrong-password-123' });
    expect(bad.status).toBe(403);
    expect((await admin.post('/api/v1/admin/reauth', { password: PASSWORD })).status).toBe(200);
    expect((await admin.post(act, { confirm: true })).status).toBe(200);
    expect((await Reward.findById(t.reward._id).lean())?.status).not.toBe('pending_approval');
  });

  it('records allowed and denied accesses immutably, without customer data', async () => {
    const { admin, owner, t, grantId } = await setup();
    const query = `?search=${encodeURIComponent(PII.email)}`;
    await admin.get(`/api/v1/admin/support/${grantId}/responses${query}`); // denied
    await owner.post(`/api/v1/businesses/${t.b._id}/support-grants/${grantId}/approve`);
    await admin.get(`/api/v1/admin/support/${grantId}/responses${query}`); // allowed
    const entries = await SupportAccessLog.find({ grantId }).lean();
    const outcomes = entries.map((e) => `${e.event}:${e.outcome}`);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        'GRANT_REQUESTED:allowed',
        'DATA_ACCESS:denied',
        'GRANT_APPROVED:allowed',
        'DATA_ACCESS:allowed',
      ]),
    );
    expect(leaks(entries)).toBeNull();
    expect(JSON.stringify(entries)).not.toContain('search=');
    await expect(SupportAccessLog.updateOne({ grantId }, { reason: 'x' })).rejects.toThrow(
      /immutable/,
    );
    await expect(SupportAccessLog.deleteMany({})).rejects.toThrow(/immutable/);
    const doc = await SupportAccessLog.findOne({ grantId });
    doc!.reason = 'tamper';
    await expect(doc!.save()).rejects.toThrow(/immutable/);
    const view = await owner.get(`/api/v1/businesses/${t.b._id}/support-grants/${grantId}/log`);
    expect(view.status).toBe(200);
    expect(view.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(view.body)).not.toContain('actorUserId');
  });

  it('keeps emergency access separate, read-only, short and subject to second-admin review', async () => {
    const owner = await client();
    const t = await tenant(owner);
    const plain = await client(true);
    const body = {
      businessId: String(t.b._id),
      ticketRef: 'INC-9',
      justification: 'Active security incident requires reviewing affected submissions urgently',
      scopes: ['responses'],
    };
    const emergency = '/api/v1/admin/support-grants/emergency';
    await plain.reauth();
    expect((await plain.post(emergency, body)).status).toBe(403);

    const breakGlass = await client(true, ['support:emergency']);
    expect((await breakGlass.post(emergency, body)).status).toBe(403); // reauth required
    await breakGlass.reauth();
    const short = await breakGlass.post(emergency, { ...body, justification: 'too short' });
    expect(short.status).toBe(422);
    const created = await breakGlass.post(emergency, body);
    expect(created.status).toBe(201);
    expect(created.body.data.emergency).toBe(true);
    expect(created.body.data.mode).toBe('read');
    const id = created.body.data.id as string;
    expect((await breakGlass.get(`/api/v1/admin/support/${id}/responses`)).status).toBe(200);
    const seen = await owner.get(`/api/v1/businesses/${t.b._id}/support-grants`);
    expect(seen.body.data[0].emergency).toBe(true);
    const selfReview = await breakGlass.post(`/api/v1/admin/support-grants/${id}/review`, {
      outcome: 'accepted',
      notes: 'self review attempt blocked',
    });
    expect(selfReview.status).toBe(403);
    const review = await plain.post(`/api/v1/admin/support-grants/${id}/review`, {
      outcome: 'accepted',
      notes: 'Reviewed ticket INC-9 and access log',
    });
    expect(review.body.data.review.status).toBe('accepted');
    const revoke = await owner.post(`/api/v1/businesses/${t.b._id}/support-grants/${id}/revoke`);
    expect(revoke.status).toBe(200);
    expect((await breakGlass.get(`/api/v1/admin/support/${id}/responses`)).status).toBe(403);
  });

  it('keeps business-owned content edits behind a write grant', async () => {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const patch = () => admin.patch(`/api/v1/admin/businesses/${t.b._id}`, { name: 'Renamed' });
    expect((await patch()).status).toBe(403);
    await activeGrant(admin.id, t.b._id, ['business_profile'], 'read');
    await admin.reauth();
    expect((await patch()).status).toBe(403); // read-only grant is insufficient
    await activeGrant(admin.id, t.b._id, ['business_profile'], 'write');
    expect((await patch()).status).toBe(200);
    expect(await SupportAccessLog.countDocuments({ outcome: 'denied', event: 'DATA_ACCESS' })).toBe(
      2,
    );
  });
});

describe('authorization boundaries', () => {
  it('rejects anonymous, ordinary users and owners on every new endpoint with 401/403', async () => {
    const owner = await client();
    const t = await tenant(owner);
    const anon = request(app);
    const paths = [
      '/api/v1/admin/support-grants',
      '/api/v1/admin/support-log',
      `/api/v1/admin/support/${new mongoose.Types.ObjectId()}/contacts`,
    ];
    for (const path of paths) {
      expect((await anon.get(path)).status, path).toBe(401);
      expect((await owner.get(path)).status, path).toBe(403);
    }
    const asOwner = await owner.post('/api/v1/admin/support-grants', {
      businessId: String(t.b._id),
      ticketRef: 'X-1',
      reason: 'Pretending to be support',
      scopes: ['contacts'],
    });
    expect(asOwner.status).toBe(403);
    expect((await owner.post('/api/v1/admin/reauth', { password: PASSWORD })).status).toBe(403);
  });
});

describe('re-authentication is bound to one session', () => {
  async function writeSetup() {
    const adminA = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    await activeGrant(adminA.id, t.b._id, ['business_profile'], 'write');
    const patch = (c: Client) =>
      c.patch(`/api/v1/admin/businesses/${t.b._id}`, { name: 'Renamed by support' });
    return { adminA, owner, t, patch };
  }

  it('cannot be reused from another browser or device of the same account', async () => {
    const { adminA, patch } = await writeSetup();
    await adminA.reauth();
    const deviceB = await session(adminA.user);
    expect((await patch(deviceB)).status).toBe(403);
    expect((await patch(adminA)).status).toBe(200);
    await deviceB.reauth();
    expect((await patch(deviceB)).status).toBe(200);
  });

  it('expires after its short validity window', async () => {
    const { adminA, patch } = await writeSetup();
    await adminA.reauth();
    expect((await patch(adminA)).status).toBe(200);
    await AdminReauth.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect((await patch(adminA)).status).toBe(403);
  });

  it('dies immediately when the session is revoked, logged out or the account is blocked', async () => {
    const { adminA, t, patch } = await writeSetup();
    // Logout revokes the refresh family; a stolen access cookie cannot keep a stale proof alive.
    await adminA.reauth();
    const other = await client(true);
    await activeGrant(other.id, t.b._id, ['business_profile'], 'write');
    await other.reauth();
    expect((await patch(other)).status).toBe(200);
    const logout = await other.post('/api/v1/auth/logout');
    expect(logout.status).toBeLessThan(300);
    // A fresh login is a different session: the old proof is useless there.
    const again = await session(other.user);
    expect((await patch(again)).status).toBe(403);
    await again.reauth();
    expect((await patch(again)).status).toBe(200);
    // Revoking sessions bumps the version: both the cookie and the proof stop working at once.
    const revoker = await client(true);
    const revoke = await revoker.post(`/api/v1/admin/users/${again.id}/action`, {
      action: 'revoke-sessions',
      confirm: true,
    });
    expect(revoke.status).toBe(200);
    expect((await patch(again)).status).toBe(401);
    const fresh = await session(again.user);
    expect((await patch(fresh)).status).toBe(403);
  });

  it('rejects legacy tokens without a session id and proofs for another account', async () => {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    await activeGrant(admin.id, t.b._id, ['business_profile'], 'write');
    // A proof stored for the same session id but a different user is ignored.
    const sid = 'forged-session-id';
    await seedSession(owner.user._id, sid);
    await AdminReauth.create({
      userId: owner.user._id,
      sessionId: sid,
      sessionVersion: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const patch = await admin.patch(`/api/v1/admin/businesses/${t.b._id}`, { name: 'x' });
    expect(patch.status).toBe(403);
  });
});

describe('grant hardening and escalation', () => {
  it('never lets a grant for one tenant touch another tenant or a different resource scope', async () => {
    const admin = await client(true);
    const ownerA = await client();
    const ownerB = await client();
    const a = await tenant(ownerA, 'A');
    const b = await tenant(ownerB, 'B');
    const grant = await activeGrant(admin.id, a.b._id, ['rewards', 'forms'], 'write');
    await admin.reauth();
    const base = `/api/v1/admin/support/${grant._id}`;
    // Records of tenant B are invisible through tenant A's grant.
    expect(
      (await admin.post(`${base}/rewards/${b.reward._id}/approve`, { confirm: true })).status,
    ).toBe(404);
    expect((await Reward.findById(b.reward._id).lean())?.status).toBe('pending_approval');
    expect(
      (
        await admin.post(`${base}/forms/${b.form._id}/publish`, {
          confirm: true,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(404);
    // Scope escalation: business profile, responses and contacts were not granted.
    expect((await admin.patch(`${base}/business`, { name: 'x' })).status).toBe(403);
    expect((await admin.get(`${base}/responses`)).status).toBe(403);
    expect((await admin.get(`${base}/contacts`)).status).toBe(403);
    // The owner of B cannot approve, revoke or even see A's grant.
    const pending = await admin.post('/api/v1/admin/support-grants', {
      businessId: String(a.b._id),
      ticketRef: 'T-9',
      reason: 'Needs owner of A to approve',
      scopes: ['responses'],
    });
    for (const action of ['approve', 'revoke', 'deny']) {
      const r = await ownerB.post(
        `/api/v1/businesses/${b.b._id}/support-grants/${pending.body.data.id}/${action}`,
      );
      expect(r.status, action).toBe(404);
    }
    expect((await SupportGrant.findById(pending.body.data.id).lean())?.status).toBe('pending');
  });

  it('stops honouring a grant when its approver stops being an active owner', async () => {
    const admin = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const grant = await activeGrant(admin.id, t.b._id, ['responses'], 'read');
    const url = `/api/v1/admin/support/${grant._id}/responses`;
    expect((await admin.get(url)).status).toBe(200);
    await BusinessMembership.updateOne({ businessId: t.b._id }, { status: 'disabled' });
    const denied = await admin.get(url);
    expect(denied.status).toBe(403);
    const entry = await SupportAccessLog.findOne({ reason: 'APPROVER_NOT_OWNER' }).lean();
    expect(entry?.outcome).toBe('denied');
  });

  it('keeps grants unusable by anyone else even with their id and the same role', async () => {
    const admin = await client(true);
    const second = await client(true);
    const owner = await client();
    const t = await tenant(owner);
    const grant = await activeGrant(admin.id, t.b._id, ['responses'], 'read');
    expect((await second.get(`/api/v1/admin/support/${grant._id}/responses`)).status).toBe(403);
    expect((await owner.get(`/api/v1/admin/support/${grant._id}/responses`)).status).toBe(403);
  });
});
