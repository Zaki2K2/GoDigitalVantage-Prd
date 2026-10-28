import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { User } from '../src/modules/auth/user.model';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { hashPassword } from '../src/modules/auth/password';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { Contact } from '../src/modules/contacts/contact.model';
import { FollowUp } from '../src/modules/followups/followup.model';

const app = createApp();
const PASSWORD = 'test-secure-password-123';
const SECRET = 'app-secret-for-tests';
const VERIFY = 'verify-token-for-tests';
let passwordHash = '';
let seq = 0;
// Baseline is "WhatsApp off" whatever a developer's local .env (e.g. mock settings) says.
Object.assign(env, {
  WHATSAPP_ENABLED: false,
  WHATSAPP_ACCESS_TOKEN: undefined,
  WHATSAPP_PHONE_NUMBER_ID: undefined,
  WHATSAPP_APP_SECRET: undefined,
  WHATSAPP_VERIFY_TOKEN: undefined,
});
const original = { ...env };

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  passwordHash = await hashPassword(PASSWORD);
});
afterAll(async () => {
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all(
    [User, RefreshToken, Business, BusinessMembership, Contact, FollowUp].map((m) =>
      (m as typeof User).deleteMany({}),
    ),
  );
});
afterEach(() => {
  Object.assign(env, original);
  vi.unstubAllGlobals();
});

const enableWhatsApp = () =>
  Object.assign(env, {
    WHATSAPP_ENABLED: true,
    WHATSAPP_ACCESS_TOKEN: 'test-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
    WHATSAPP_APP_SECRET: SECRET,
    WHATSAPP_VERIFY_TOKEN: VERIFY,
  });

async function login(role: 'USER' | 'SUPER_ADMIN' = 'USER') {
  const user = await User.create({
    fullName: 'Tester',
    emailLowercase: `followup-${++seq}@example.test`,
    passwordHash,
    platformRole: role,
  });
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  const res = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', csrf)
    .send({ email: user.emailLowercase, password: PASSWORD });
  expect(res.status).toBe(200);
  return {
    user,
    get: (url: string) => agent.get(url),
    post: (url: string, body: object = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
  };
}
type Client = Awaited<ReturnType<typeof login>>;

async function business(owner: Client, role: 'owner' | 'member' = 'owner') {
  const b = await Business.create({
    ownerUserId: owner.user._id,
    createRequestId: randomUUID(),
    name: 'Follow Cafe',
    category: 'Cafe',
    timezone: 'UTC',
    slug: `follow-${randomUUID()}`,
  });
  await BusinessMembership.create({ businessId: b._id, userId: owner.user._id, role });
  return b;
}
const contact = (
  businessId: mongoose.Types.ObjectId,
  over: Record<string, unknown> = {},
  phone = '+14155550123',
) =>
  Contact.create({
    businessId,
    fullName: 'Zelda',
    phoneE164: phone,
    consent: {
      reviewRequestSms: null,
      marketingSms: null,
      whatsappFollowUp: new Date(Date.now() - 60_000),
    },
    firstResponseAt: new Date(),
    lastResponseAt: new Date(),
    ...over,
  });

const fetchOk = (id = 'wamid.OUT1') =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: id }] }),
  });

const signed = (payload: object, secret = SECRET) => {
  const body = JSON.stringify(payload);
  return {
    body,
    sig: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
  };
};
const hook = (payload: object, secret?: string) => {
  const { body, sig } = signed(payload, secret);
  return request(app)
    .post('/api/v1/webhooks/whatsapp')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(body);
};
const change = (value: object) => ({ entry: [{ changes: [{ value }] }] });

describe('feedback follow-up: sending', () => {
  it('does nothing automatically: no send happens when a contact exists', async () => {
    enableWhatsApp();
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    const owner = await login();
    const b = await business(owner);
    await contact(b._id);
    expect(f).not.toHaveBeenCalled();
    expect(await FollowUp.countDocuments()).toBe(0);
  });

  it('sends a template outside the 24h window, never exposing the token in history', async () => {
    enableWhatsApp();
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id);
    const sendUrl = `/api/v1/businesses/${b._id}/contacts/${c._id}/followups`;
    const message = 'Sorry about your visit, can we help?';
    // Outside the 24h window the owner's text is never silently swapped for a template.
    const unconfirmed = await owner.post(sendUrl, { channel: 'whatsapp_api', message });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error.code).toBe('TEMPLATE_CONFIRMATION_REQUIRED');
    expect(unconfirmed.body.error.details.template).toBe('hello_world');
    const wrong = await owner.post(sendUrl, {
      channel: 'whatsapp_api',
      message,
      confirmTemplate: 'other',
    });
    expect(wrong.status).toBe(409);
    expect(f).not.toHaveBeenCalled();
    expect(await FollowUp.countDocuments()).toBe(0);
    const res = await owner.post(sendUrl, {
      channel: 'whatsapp_api',
      message,
      confirmTemplate: 'hello_world',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'sent', template: 'hello_world' });
    expect(res.body.data.body).toContain('Your typed message was not sent');
    expect(res.body.data.body).not.toContain(message);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toContain('/123456789012345/messages');
    expect(JSON.parse(init.body)).toMatchObject({ to: '14155550123', type: 'template' });
    expect(JSON.stringify(res.body)).not.toContain('test-token');
  });

  it('sends free text after the customer replied within 24h', async () => {
    enableWhatsApp();
    const f = fetchOk('wamid.OUT2');
    vi.stubGlobal('fetch', f);
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id);
    await FollowUp.create({
      businessId: b._id,
      contactId: c._id,
      direction: 'inbound',
      channel: 'whatsapp_api',
      body: 'hi',
      status: 'received',
      providerMessageId: 'wamid.IN0',
      phoneDigits: '14155550123',
    });
    const res = await owner.post(`/api/v1/businesses/${b._id}/contacts/${c._id}/followups`, {
      channel: 'whatsapp_api',
      message: 'Thanks for replying',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.template).toBeNull();
    expect(JSON.parse(f.mock.calls[0]![1].body)).toMatchObject({
      type: 'text',
      text: { body: 'Thanks for replying' },
    });
  });

  it('records a provider failure honestly', async () => {
    enableWhatsApp();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 131030 } }),
      }),
    );
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id);
    const res = await owner.post(`/api/v1/businesses/${b._id}/contacts/${c._id}/followups`, {
      channel: 'whatsapp_api',
      message: 'Hello there',
      confirmTemplate: 'hello_world',
    });
    expect(res.body.data).toMatchObject({ status: 'failed', errorCode: 'meta_131030' });
  });

  it('refuses without consent, without a phone, or after STOP, on both channels', async () => {
    enableWhatsApp();
    const f = fetchOk();
    vi.stubGlobal('fetch', f);
    const owner = await login();
    const b = await business(owner);
    // Review-request and promotional permission must NOT authorise a WhatsApp follow-up.
    const noConsent = await contact(b._id, {
      consent: { reviewRequestSms: new Date(), marketingSms: new Date(), whatsappFollowUp: null },
    });
    const noPhone = await contact(b._id, { phoneE164: null, emailLowercase: 'a@example.test' });
    const stopped = await contact(b._id, { followUpOptOutAt: new Date() }, '+14155550999');
    for (const [c, code] of [
      [noConsent, 'FOLLOWUP_NO_CONSENT'],
      [noPhone, 'FOLLOWUP_NO_PHONE'],
      [stopped, 'FOLLOWUP_OPTED_OUT'],
    ] as const)
      for (const channel of ['whatsapp_api', 'click_to_chat']) {
        const res = await owner.post(`/api/v1/businesses/${b._id}/contacts/${c._id}/followups`, {
          channel,
          message: 'Hello there',
        });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe(code);
      }
    expect(f).not.toHaveBeenCalled();
    expect(await FollowUp.countDocuments()).toBe(0);
  });

  it('a new consent grant after STOP re-enables follow-up', async () => {
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id, {
      followUpOptOutAt: new Date(Date.now() - 120_000),
      consent: { reviewRequestSms: null, marketingSms: null, whatsappFollowUp: new Date() },
    });
    const res = await owner.post(`/api/v1/businesses/${b._id}/contacts/${c._id}/followups`, {
      channel: 'click_to_chat',
      message: 'Hello there',
    });
    expect(res.status).toBe(201);
  });

  it('click-to-chat returns a prefilled link and records it as prepared, not sent', async () => {
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id);
    const res = await owner.post(`/api/v1/businesses/${b._id}/contacts/${c._id}/followups`, {
      channel: 'click_to_chat',
      message: 'Hi Zelda & co',
    });
    expect(res.status).toBe(201);
    expect(res.body.link).toBe('https://wa.me/14155550123?text=Hi%20Zelda%20%26%20co');
    expect(res.body.data.status).toBe('prepared');
  });

  it('falls back with a clear error when the Cloud API is not configured', async () => {
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id);
    const cfg = await owner.get(`/api/v1/businesses/${b._id}/followups/config`);
    expect(cfg.body.data).toEqual({ whatsappApi: false, clickToChat: true });
    const res = await owner.post(`/api/v1/businesses/${b._id}/contacts/${c._id}/followups`, {
      channel: 'whatsapp_api',
      message: 'Hello there',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WHATSAPP_NOT_CONFIGURED');
  });
});

describe('feedback follow-up: company scoping', () => {
  it('blocks other tenants, members without permission, Super Admins and anonymous callers', async () => {
    enableWhatsApp();
    vi.stubGlobal('fetch', fetchOk());
    const ownerA = await login();
    const a = await business(ownerA);
    const ca = await contact(a._id);
    const ownerB = await login();
    const b = await business(ownerB);
    const admin = await login('SUPER_ADMIN');
    const memberUser = await login();
    await BusinessMembership.create({
      businessId: a._id,
      userId: memberUser.user._id,
      role: 'member',
    });
    const body = { channel: 'click_to_chat', message: 'Hello there' };

    // Tenant B cannot use A's contact, even through its own business URL.
    expect(
      (await ownerB.post(`/api/v1/businesses/${b._id}/contacts/${ca._id}/followups`, body)).status,
    ).toBe(404);
    // ...nor A's URL.
    expect(
      (await ownerB.post(`/api/v1/businesses/${a._id}/contacts/${ca._id}/followups`, body)).status,
    ).toBe(403);
    expect((await ownerB.get(`/api/v1/businesses/${a._id}/followups`)).status).toBe(403);
    // A read-only member can read history but not send.
    expect((await memberUser.get(`/api/v1/businesses/${a._id}/followups`)).status).toBe(200);
    expect(
      (await memberUser.post(`/api/v1/businesses/${a._id}/contacts/${ca._id}/followups`, body))
        .status,
    ).toBe(403);
    // Super Admin has no membership: no history, no sending.
    expect((await admin.get(`/api/v1/businesses/${a._id}/followups`)).status).toBe(403);
    expect(
      (await admin.post(`/api/v1/businesses/${a._id}/contacts/${ca._id}/followups`, body)).status,
    ).toBe(403);
    expect((await request(app).get(`/api/v1/businesses/${a._id}/followups`)).status).toBe(401);
    // A response from another customer cannot be attached.
    const res = await ownerA.post(`/api/v1/businesses/${a._id}/contacts/${ca._id}/followups`, {
      ...body,
      responseId: String(new mongoose.Types.ObjectId()),
    });
    expect(res.status).toBe(404);
  });

  it('history is per business and per contact', async () => {
    const owner = await login();
    const a = await business(owner);
    const c1 = await contact(a._id);
    const c2 = await contact(a._id, {}, '+14155550888');
    for (const c of [c1, c2])
      await owner.post(`/api/v1/businesses/${a._id}/contacts/${c._id}/followups`, {
        channel: 'click_to_chat',
        message: 'Hello there',
      });
    const all = await owner.get(`/api/v1/businesses/${a._id}/followups`);
    expect(all.body.pagination.total).toBe(2);
    const one = await owner.get(`/api/v1/businesses/${a._id}/followups?contactId=${c1._id}`);
    expect(one.body.data).toHaveLength(1);
  });
});

describe('WhatsApp webhook', () => {
  it('answers the verification handshake only with the right token', async () => {
    enableWhatsApp();
    const q = (token: string) =>
      request(app).get(
        `/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc123`,
      );
    const ok = await q(VERIFY);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc123');
    expect((await q('wrong-token-value')).status).toBe(403);
  });

  it('rejects unsigned, wrongly signed and disabled webhooks without changing anything', async () => {
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id);
    await FollowUp.create({
      businessId: b._id,
      contactId: c._id,
      direction: 'outbound',
      channel: 'whatsapp_api',
      body: 'x',
      status: 'sent',
      providerMessageId: 'wamid.OUT1',
      phoneDigits: '14155550123',
    });
    const payload = change({ statuses: [{ id: 'wamid.OUT1', status: 'read' }] });
    expect((await hook(payload)).status).toBe(404); // not enabled
    enableWhatsApp();
    expect(
      (
        await request(app)
          .post('/api/v1/webhooks/whatsapp')
          .set('content-type', 'application/json')
          .send(payload)
      ).status,
    ).toBe(403);
    expect((await hook(payload, 'some-other-secret')).status).toBe(403);
    expect((await FollowUp.findOne({ providerMessageId: 'wamid.OUT1' }))!.status).toBe('sent');
  });

  it('applies delivery statuses forward only and records failures', async () => {
    enableWhatsApp();
    const owner = await login();
    const b = await business(owner);
    const c = await contact(b._id);
    await FollowUp.create({
      businessId: b._id,
      contactId: c._id,
      direction: 'outbound',
      channel: 'whatsapp_api',
      body: 'x',
      status: 'sent',
      providerMessageId: 'wamid.OUT1',
      phoneDigits: '14155550123',
    });
    const status = async (s: string, errors?: object[]) => {
      const res = await hook(change({ statuses: [{ id: 'wamid.OUT1', status: s, errors }] }));
      expect(res.status).toBe(200);
      return (await FollowUp.findOne({ providerMessageId: 'wamid.OUT1' }))!.status;
    };
    expect(await status('delivered')).toBe('delivered');
    expect(await status('read')).toBe('read');
    expect(await status('delivered')).toBe('read'); // out-of-order retry
    expect(await status('failed', [{ code: 1 }])).toBe('read'); // read cannot become failed
  });

  it('stores a reply under the business that messaged the customer, once, and honours STOP', async () => {
    enableWhatsApp();
    const ownerA = await login();
    const a = await business(ownerA);
    const ca = await contact(a._id);
    const ownerB = await login();
    const b = await business(ownerB);
    const cb = await contact(b._id, {}, '+14155550777');
    await FollowUp.create({
      businessId: a._id,
      contactId: ca._id,
      direction: 'outbound',
      channel: 'whatsapp_api',
      body: 'x',
      status: 'delivered',
      providerMessageId: 'wamid.OUT1',
      phoneDigits: '14155550123',
    });
    const reply = (id: string, body: string) =>
      change({ messages: [{ id, from: '14155550123', type: 'text', text: { body } }] });
    await hook(reply('wamid.IN1', 'Thanks, call me'));
    await hook(reply('wamid.IN1', 'Thanks, call me')); // Meta retry
    const inbound = await FollowUp.find({ direction: 'inbound' });
    expect(inbound).toHaveLength(1);
    expect(String(inbound[0]!.businessId)).toBe(String(a._id));
    expect((await Contact.findById(ca._id))!.followUpOptOutAt).toBeNull();
    // A stranger who never received a message is ignored.
    await hook(
      change({
        messages: [{ id: 'wamid.IN9', from: '19998887777', type: 'text', text: { body: 'hi' } }],
      }),
    );
    expect(await FollowUp.countDocuments({ direction: 'inbound' })).toBe(1);
    expect(await FollowUp.countDocuments({ businessId: b._id })).toBe(0);
    expect((await Contact.findById(cb._id))!.followUpOptOutAt).toBeNull();

    await hook(reply('wamid.IN2', 'STOP'));
    expect((await Contact.findById(ca._id))!.followUpOptOutAt).toBeInstanceOf(Date);
    const blocked = await ownerA.post(`/api/v1/businesses/${a._id}/contacts/${ca._id}/followups`, {
      channel: 'click_to_chat',
      message: 'Hello there',
    });
    expect(blocked.body.error.code).toBe('FOLLOWUP_OPTED_OUT');
  });
});

describe('adding a contact manually', () => {
  it('lets an owner add a consent-free contact and blocks duplicates, members and other tenants', async () => {
    const owner = await login();
    const a = await business(owner);
    const res = await owner.post(`/api/v1/businesses/${a._id}/contacts`, {
      fullName: 'Walk In',
      email: ' Walk.In@Example.TEST ',
      phone: '+1 (415) 555-0100',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fullName: 'Walk In',
      email: 'walk.in@example.test',
      phone: '+14155550100',
      responseCount: 0,
      consent: { reviewRequestSms: null, marketingSms: null },
    });
    // No consent => follow-up stays blocked.
    const fu = await owner.post(
      `/api/v1/businesses/${a._id}/contacts/${res.body.data.id}/followups`,
      { channel: 'click_to_chat', message: 'Hello there' },
    );
    expect(fu.body.error.code).toBe('FOLLOWUP_NO_CONSENT');
    const dup = await owner.post(`/api/v1/businesses/${a._id}/contacts`, { phone: '+14155550100' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONTACT_EXISTS');
    expect((await owner.post(`/api/v1/businesses/${a._id}/contacts`, {})).status).toBe(422);
    expect(
      (await owner.post(`/api/v1/businesses/${a._id}/contacts`, { phone: '5550100' })).status,
    ).toBe(422);

    const other = await login();
    const b = await business(other);
    // The same phone is fine in another business; the other owner cannot write into A.
    expect(
      (await other.post(`/api/v1/businesses/${b._id}/contacts`, { phone: '+14155550100' })).status,
    ).toBe(201);
    expect(
      (await other.post(`/api/v1/businesses/${a._id}/contacts`, { email: 'x@example.test' }))
        .status,
    ).toBe(403);
    const member = await login();
    await BusinessMembership.create({ businessId: a._id, userId: member.user._id, role: 'member' });
    expect(
      (await member.post(`/api/v1/businesses/${a._id}/contacts`, { email: 'y@example.test' }))
        .status,
    ).toBe(403);
    const admin = await login('SUPER_ADMIN');
    expect(
      (await admin.post(`/api/v1/businesses/${a._id}/contacts`, { email: 'z@example.test' }))
        .status,
    ).toBe(403);
  });
});

describe('WhatsApp webhook: same phone in several businesses', () => {
  const PHONE = '14155550123';
  async function twoBusinesses() {
    const ownerA = await login();
    const a = await business(ownerA);
    const ca = await contact(a._id);
    const ownerB = await login();
    const b = await business(ownerB);
    const cb = await contact(b._id);
    const out = (
      businessId: mongoose.Types.ObjectId,
      contactId: mongoose.Types.ObjectId,
      id: string,
    ) =>
      FollowUp.create({
        businessId,
        contactId,
        direction: 'outbound',
        channel: 'whatsapp_api',
        body: 'x',
        status: 'delivered',
        providerMessageId: id,
        phoneDigits: PHONE,
      });
    await out(a._id, ca._id, 'wamid.A1');
    await out(b._id, cb._id, 'wamid.B1'); // B is the most recent sender
    return { a, ca, b, cb };
  }
  const msg = (id: string, body: string, quoted?: string) =>
    change({
      messages: [
        {
          id,
          from: PHONE,
          type: 'text',
          text: { body },
          ...(quoted ? { context: { id: quoted } } : {}),
        },
      ],
    });

  it('routes a reply to the business whose message it quotes, not the last sender', async () => {
    enableWhatsApp();
    const { a, b } = await twoBusinesses();
    await hook(msg('wamid.IN1', 'Re A', 'wamid.A1'));
    const row = await FollowUp.findOne({ providerMessageId: 'wamid.IN1' });
    expect(String(row!.businessId)).toBe(String(a._id));
    expect(await FollowUp.countDocuments({ businessId: b._id, direction: 'inbound' })).toBe(0);
  });

  it('does not guess when the reply quotes nothing: no tenant stores the text', async () => {
    enableWhatsApp();
    await twoBusinesses();
    await hook(msg('wamid.IN2', 'who am I answering?'));
    expect(await FollowUp.countDocuments({ direction: 'inbound' })).toBe(0);
  });

  it('routes an unquoted reply when only one business messaged recently', async () => {
    enableWhatsApp();
    const { b } = await twoBusinesses();
    await FollowUp.collection.updateMany(
      { providerMessageId: 'wamid.A1' },
      { $set: { createdAt: new Date(Date.now() - 30 * 24 * 3600_000) } },
    );
    await hook(msg('wamid.IN3', 'hello'));
    const row = await FollowUp.findOne({ providerMessageId: 'wamid.IN3' });
    expect(String(row!.businessId)).toBe(String(b._id));
  });

  it('applies STOP to every business that messaged the number, even if unroutable', async () => {
    enableWhatsApp();
    const { ca, cb } = await twoBusinesses();
    await hook(msg('wamid.IN4', 'STOP'));
    expect(await FollowUp.countDocuments({ direction: 'inbound' })).toBe(0);
    expect((await Contact.findById(ca._id))!.followUpOptOutAt).toBeInstanceOf(Date);
    expect((await Contact.findById(cb._id))!.followUpOptOutAt).toBeInstanceOf(Date);
  });
});
