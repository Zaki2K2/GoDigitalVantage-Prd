import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { AdminReauth, SupportGrant } from '../src/modules/admin/support.model';
import { activeGrant } from './support-helpers';
import { reviewPlatformCampaigns } from '../src/modules/campaigns/campaign.legacy-audit';
import { User } from '../src/modules/auth/user.model';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { Contact } from '../src/modules/contacts/contact.model';
import { AdminAudit } from '../src/modules/admin/admin.model';
import { Reward, RewardOrderClaim } from '../src/modules/rewards/reward.model';
import {
  MarketingConsent,
  MarketingSuppression,
  unsubscribeToken,
  marketingAllowed,
} from '../src/modules/campaigns/campaign.marketing';
import { redeem } from '../src/modules/rewards/reward.service';
import { recordEmailReceipt } from '../src/modules/email/email.model';
import {
  Campaign,
  CampaignExecution,
  CampaignRecipient,
  CampaignLock,
  CampaignTemplate,
  CampaignSchedulerState,
} from '../src/modules/campaigns/campaign.model';
import {
  campaignInput,
  campaignConfig,
  executionWindow,
  occasionDate,
  profileSchema,
} from '../src/modules/campaigns/campaign.domain';
import { estimateAudience } from '../src/modules/campaigns/campaign.audience';
import { createCampaign, updateCampaign } from '../src/modules/campaigns/campaign.service';
import { executeCampaign } from '../src/modules/campaigns/campaign.execution';
import {
  migrateCampaignIndexes,
  campaignIndexesReady,
} from '../src/modules/campaigns/campaign.migration';

const now = new Date('2026-10-20T10:00:00Z');
const input = (over: object = {}) => ({
  name: 'Tuesday Special',
  audience: { type: 'all' },
  startDate: '2026-10-01T00:00:00Z',
  endDate: '2027-11-01T00:00:00Z',
  timezone: 'UTC',
  trigger: { type: 'daily', sendTime: '00:00' },
  channels: ['email'],
  offer: { discountType: 'percent', discountValue: 20, currency: 'USD', validityDays: 7 },
  usageLimit: 1000,
  perCustomerLimit: 1000,
  ...over,
});

describe('campaign trigger rules', () => {
  it('handles weekday and weekend recurrence', () => {
    const t = campaignInput.parse(
      input({ trigger: { type: 'weekly', weekdays: [2], sendTime: '09:00' } }),
    );
    expect(executionWindow(t, now)).toBe('2026-10-20');
    expect(executionWindow(t, new Date('2026-10-21T10:00:00Z'))).toBeNull();
    t.trigger.weekdays = [0, 6];
    expect(executionWindow(t, new Date('2026-10-24T10:00:00Z'))).toBe('2026-10-24');
    expect(executionWindow(t, new Date('2026-10-25T10:00:00Z'))).toBe('2026-10-25');
  });
  it('respects timezone, send times and exclusive campaign end', () => {
    const c = campaignInput.parse(
      input({
        timezone: 'Asia/Karachi',
        trigger: { type: 'daily', sendTime: '09:00', endTime: '18:00' },
      }),
    );
    expect(executionWindow(c, new Date('2026-10-20T03:59:00Z'))).toBeNull();
    expect(executionWindow(c, new Date('2026-10-20T04:00:00Z'))).toBe('2026-10-20');
    expect(executionWindow(c, c.endDate)).toBeNull();
    expect(executionWindow(c, new Date('2026-09-30T10:00:00Z'))).toBeNull();
  });
  it('supports monthly/yearly dates and skips nonexistent dates', () => {
    const c = campaignInput.parse(
      input({ trigger: { type: 'monthly', dayOfMonth: 31, sendTime: '00:00' } }),
    );
    expect(executionWindow(c, now)).toBeNull();
    expect(executionWindow(c, new Date('2026-10-31T10:00:00Z'))).toBe('2026-10-31');
    c.trigger.type = 'yearly';
    c.trigger.month = 12;
    expect(executionWindow(c, new Date('2026-10-31T10:00:00Z'))).toBeNull();
    expect(executionWindow(c, new Date('2026-12-31T10:00:00Z'))).toBe('2026-12-31');
  });
  it('handles spring DST gaps at the next valid time within the send window', () => {
    const c = campaignInput.parse(
      input({
        timezone: 'America/New_York',
        trigger: { type: 'daily', sendTime: '02:30', endTime: '03:30' },
      }),
    );
    expect(executionWindow(c, new Date('2027-03-14T06:59:00Z'))).toBeNull();
    expect(executionWindow(c, new Date('2027-03-14T07:00:00Z'))).toBe('2027-03-14');
  });
  it('handles advance birthday notice across year boundaries', () => {
    const c = campaignInput.parse(input({ trigger: { type: 'birthday', daysBefore: 7 } }));
    expect(occasionDate(c, new Date('2026-12-28T10:00:00Z'))).toEqual({
      monthDay: '01-04',
      year: 2027,
    });
  });
  it('rejects invalid rules and profile dates', () => {
    expect(campaignInput.safeParse(input({ timezone: 'Imaginary/City' })).success).toBe(false);
    expect(
      campaignInput.safeParse(
        input({
          offer: { discountType: 'percent', discountValue: 101, currency: 'USD', validityDays: 7 },
        }),
      ).success,
    ).toBe(false);
    expect(campaignInput.safeParse(input({ channels: ['sms'] })).success).toBe(false);
    expect(profileSchema.safeParse({ birthday: '02-30' }).success).toBe(false);
    expect(profileSchema.safeParse({ birthday: '02-29' }).success).toBe(true);
  });
});

describe('campaign API and execution', () => {
  const app = createApp();
  const models = [
    SupportGrant,
    AdminReauth,
    Campaign,
    CampaignExecution,
    CampaignRecipient,
    CampaignLock,
    CampaignTemplate,
    Reward,
    Contact,
    Business,
    BusinessMembership,
    AdminAudit,
    User,
    MarketingConsent,
    MarketingSuppression,
    RewardOrderClaim,
    CampaignSchedulerState,
  ];
  let seq = 0;
  async function actor() {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
    const r = await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({
        fullName: 'Campaign owner',
        email: `campaign-${++seq}-${Date.now()}@example.com`,
        password: 'correct-horse-battery',
      });
    expect(r.status).toBe(201);
    return {
      id: r.body.data.user.id as string,
      agent,
      post: (url: string, body: object = {}) =>
        agent.post(url).set('X-CSRF-Token', csrf).send(body),
      patch: (url: string, body: object) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    };
  }
  let owner: Awaited<ReturnType<typeof actor>>,
    other: Awaited<ReturnType<typeof actor>>,
    staff: Awaited<ReturnType<typeof actor>>;
  let businessId: string, otherBusinessId: string, base: string;
  beforeAll(async () => {
    if (!process.env['MONGODB_URI']?.endsWith('/gdv_test'))
      throw new Error('Test database required');
    await mongoose.connect(process.env['MONGODB_URI']!);
    await Promise.all(models.map((m) => m.init()));
  });
  // Fixtures are written against the fixed instant `now`. Freeze only Date (timers stay real so
  // database I/O is unaffected) so reward expiry, campaign end dates and token lifetimes are
  // evaluated at that instant instead of drifting with the wall clock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(async () => {
    await Promise.all(models.map((m) => (m as typeof User).deleteMany({})));
    owner = await actor();
    other = await actor();
    staff = await actor();
    const makeBusiness = async (id: string) =>
      Business.create({
        ownerUserId: id,
        createRequestId: randomUUID(),
        name: 'Cafe',
        category: 'Cafe',
        timezone: 'UTC',
        slug: randomUUID(),
        status: 'active',
      });
    businessId = String((await makeBusiness(owner.id))._id);
    otherBusinessId = String((await makeBusiness(other.id))._id);
    await BusinessMembership.create([
      { businessId, userId: owner.id, role: 'owner' },
      { businessId: otherBusinessId, userId: other.id, role: 'owner' },
      { businessId, userId: staff.id, role: 'member' },
    ]);
    base = `/api/v1/businesses/${businessId}/campaigns`;
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  async function contact(over: object = {}, consented = true) {
    const created = await Contact.create({
      businessId,
      emailLowercase: `customer-${randomUUID()}@example.com`,
      firstResponseAt: now,
      lastResponseAt: now,
      ...over,
    });
    if (consented)
      await MarketingConsent.create({
        businessId: created.businessId,
        contactId: created._id,
        email: created.emailLowercase!,
        state: 'granted',
        evidence: 'Explicit customer opt-in test fixture',
        actorUserId: owner.id,
        at: now,
      });
    return created;
  }
  async function active(over: object = {}) {
    const c = await createCampaign(campaignInput.parse(input(over)), businessId, owner.id);
    await Campaign.updateOne({ _id: c._id }, { $set: { status: 'active' } });
    return c;
  }
  it('enforces authentication, CSRF, tenant isolation and role permissions', async () => {
    expect((await request(app).get(base)).status).toBe(401);
    expect((await other.agent.get(base)).status).toBe(403);
    expect((await staff.agent.get(base)).status).toBe(200);
    expect((await staff.post(base, { input: input() })).status).toBe(403);
    expect((await owner.agent.post(base).send({ input: input() })).status).toBe(403);
    const c = await active();
    expect(
      (await other.agent.get(`/api/v1/businesses/${otherBusinessId}/campaigns/${c._id}`)).status,
    ).toBe(404);
  });
  it('supports drafts, optimistic editing, preview, schedule, pause, resume, duplicate and cancel', async () => {
    const r = await owner.post(base, { input: input() });
    expect(r.status).toBe(201);
    const id = r.body.data._id;
    expect(
      (await owner.patch(`${base}/${id}`, { input: input({ name: 'Updated' }), revision: 0 }))
        .status,
    ).toBe(200);
    expect((await owner.patch(`${base}/${id}`, { input: input(), revision: 0 })).status).toBe(409);
    expect((await owner.agent.get(`${base}/${id}`)).body.data.estimatedRecipients).toBe(0);
    expect(
      (await owner.post(`${base}/${id}/schedule`, { confirm: true, revision: 1 })).status,
    ).toBe(409);
    expect(
      (
        await owner.post(`${base}/${id}/schedule`, {
          confirm: true,
          revision: 1,
          confirmedCount: 0,
        })
      ).status,
    ).toBe(200);
    expect((await owner.patch(`${base}/${id}`, { input: input(), revision: 2 })).status).toBe(409);
    expect((await owner.post(`${base}/${id}/pause`, { confirm: true, revision: 2 })).status).toBe(
      200,
    );
    expect(
      (await owner.post(`${base}/${id}/resume`, { confirm: true, revision: 3, confirmedCount: 0 }))
        .status,
    ).toBe(200);
    const duplicate = await owner.post(`${base}/${id}/duplicate`);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.status).toBe('draft');
    expect(
      (await owner.post(`${base}/${id}/cancel`, { confirm: true, revision: 4 })).body.data.status,
    ).toBe('cancelled');
    expect(
      await AdminAudit.countDocuments({ entity: 'campaign', outcome: 'completed' }),
    ).toBeGreaterThanOrEqual(7);
  });
  it('allows Super Admin inspection and scoped platform creation without tenant bypass', async () => {
    expect((await owner.agent.get('/api/v1/admin/campaigns')).status).toBe(403);
    await User.updateOne({ _id: other.id }, { $set: { platformRole: 'SUPER_ADMIN' } });
    expect(
      (await other.post('/api/v1/admin/campaigns', { input: input(), businessId })).status,
    ).toBe(403);
    await activeGrant(other.id, businessId, ['campaigns'], 'write');
    expect(
      (await other.post('/api/v1/admin/reauth', { password: 'correct-horse-battery' })).status,
    ).toBe(200);
    const r = await other.post('/api/v1/admin/campaigns', { input: input(), businessId });
    expect(r.status).toBe(201);
    expect(r.body.data.ownerType).toBe('platform');
    expect((await other.agent.get(base)).status).toBe(403);
    expect(
      (await owner.patch(`${base}/${r.body.data._id}`, { input: input(), revision: 0 })).status,
    ).toBe(403);
    expect((await other.agent.get('/api/v1/admin/campaigns')).body.pagination.total).toBe(1);
  });
  it('creates global templates and idempotently assigns tenant-specific drafts', async () => {
    await User.updateOne({ _id: other.id }, { $set: { platformRole: 'SUPER_ADMIN' } });
    const t = await other.post('/api/v1/admin/campaigns/templates', input());
    expect(t.status).toBe(201);
    const url = `/api/v1/admin/campaigns/templates/${t.body.data._id}/assign`;
    await activeGrant(other.id, businessId, ['campaigns'], 'write');
    expect(
      (await other.post('/api/v1/admin/reauth', { password: 'correct-horse-battery' })).status,
    ).toBe(200);
    // Bulk assignment only reaches businesses that approved write access.
    const r = await other.post(url, { all: true });
    expect(r.status).toBe(201);
    expect(r.body.data).toHaveLength(1);
    expect((await other.post(url, { businessIds: [otherBusinessId] })).status).toBe(403);
    expect((await other.post(url, { businessIds: [businessId] })).status).toBe(201);
    expect(await Campaign.countDocuments()).toBe(1);
  });
  it('scopes selected contacts and segmentation to one tenant', async () => {
    const a = await contact({ tags: ['vip'], segment: 'local', loyaltyLevel: 'gold' });
    const b = await contact({ businessId: otherBusinessId, tags: ['vip'] });
    await contact();
    const c = campaignInput.parse(
      input({ audience: { type: 'tags', tags: ['vip'], segment: 'local' } }),
    );
    expect(await estimateAudience(c, businessId, now)).toBe(1);
    c.audience.type = 'selected';
    c.audience.contactIds = [String(a._id), String(b._id)];
    c.audience.tags = [];
    c.audience.segment = '';
    expect(await estimateAudience(c, businessId, now)).toBe(1);
    c.audience.minInteractions = 1;
    expect(await estimateAudience(c, businessId, now)).toBe(0);
  });
  it('updates customer campaign profiles only for authorized owners', async () => {
    const c = await contact();
    const url = `/api/v1/businesses/${businessId}/contacts/${c._id}/campaign-profile`;
    expect((await staff.patch(url, { birthday: '10-20' })).status).toBe(403);
    expect((await owner.patch(url, { birthday: '02-30' })).status).toBe(422);
    expect((await owner.patch(url, { birthday: '10-20', tags: ['vip'] })).status).toBe(200);
    expect(
      (await owner.agent.get(`/api/v1/businesses/${businessId}/contacts/${c._id}`)).body.data
        .contact.birthday,
    ).toBe('10-20');
  });
  it('executes birthdays once per occasion year, excluding missing birthdays', async () => {
    await contact({ birthday: '10-20' });
    await contact({ birthday: null });
    await contact({ birthday: '10-21' });
    const c = await active({
      trigger: { type: 'birthday', sendTime: '00:00' },
      perCustomerLimit: 1,
    });
    const provider = { send: vi.fn(async () => ({ id: randomUUID() })) };
    await executeCampaign(String(c._id), provider, now);
    await executeCampaign(String(c._id), provider, now);
    expect(provider.send).toHaveBeenCalledTimes(1);
    await executeCampaign(String(c._id), provider, new Date('2027-10-20T10:00:00Z'));
    expect(provider.send).toHaveBeenCalledTimes(2);
  });
  it('prevents duplicate execution and creates reusable redeemable rewards', async () => {
    await contact();
    const c = await active({ trigger: { type: 'once', sendTime: '00:00' } });
    const provider = { send: vi.fn(async () => ({ id: randomUUID() })) };
    await executeCampaign(String(c._id), provider, now);
    await executeCampaign(String(c._id), provider, now);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await Reward.countDocuments()).toBe(1);
    const reward = (await Reward.findOne().lean())!;
    expect(reward.responseId).toBeNull();
    expect(reward.discountValue).toBe(20);
    expect(+reward.expiresAt! - +reward.issuedAt!).toBe(7 * 86400000);
    // Existing redemption service owns the single-use guarantee (use current time for this fixture).
    await Reward.updateOne(
      { _id: reward._id },
      { $set: { expiresAt: new Date(Date.now() + 86400000) } },
    );
    await redeem(businessId, owner.id, reward.code, randomUUID(), 100, 'order-001');
    await expect(
      redeem(businessId, owner.id, reward.code, randomUUID(), 100),
    ).rejects.toMatchObject({ code: 'REWARD_ALREADY_REDEEMED' });
  });
  it('retries partial delivery with the same provider key and payload', async () => {
    await contact();
    const c = await active();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Provider timeout'))
      .mockResolvedValue({ id: 'campaign-provider-id' });
    await executeCampaign(String(c._id), { send }, now);
    expect((await CampaignRecipient.findOne())?.status).toBe('failed');
    await executeCampaign(String(c._id), { send }, new Date(+now + 60000));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
    expect(await Reward.countDocuments()).toBe(1);
    expect((await CampaignRecipient.findOne())?.status).toBe('accepted');
  });
  it('records invalid or deleted recipients without sending', async () => {
    await contact({ emailLowercase: 'invalid' });
    const c = await active();
    const provider = { send: vi.fn() };
    await executeCampaign(String(c._id), provider, now);
    expect(provider.send).not.toHaveBeenCalled();
    expect((await CampaignRecipient.findOne())?.status).toBe('skipped');
  });
  it('respects pause, expiry, moderation, disabled owners and capacity limits', async () => {
    await contact();
    await contact();
    const c = await active({ usageLimit: 1 });
    const provider = { send: vi.fn(async () => ({ id: randomUUID() })) };
    await Campaign.updateOne({ _id: c._id }, { $set: { status: 'paused' } });
    await executeCampaign(String(c._id), provider, now);
    expect(provider.send).not.toHaveBeenCalled();
    await Campaign.updateOne({ _id: c._id }, { $set: { status: 'active' } });
    await Business.updateOne({ _id: businessId }, { $set: { adminState: 'suspended' } });
    await executeCampaign(String(c._id), provider, now);
    expect(provider.send).not.toHaveBeenCalled();
    await Business.updateOne({ _id: businessId }, { $set: { adminState: 'active' } });
    await executeCampaign(String(c._id), provider, now);
    expect(provider.send).toHaveBeenCalledTimes(1);
    await executeCampaign(String(c._id), provider, new Date('2028-01-01T10:00:00Z'));
    expect((await Campaign.findById(c._id))?.status).toBe('completed');
  });
  it('fails closed for concurrent/abandoned locks and expired retry operations', async () => {
    await contact();
    const c = await active();
    await CampaignLock.create({ _id: String(c._id), token: 'abandoned', at: now });
    await expect(executeCampaign(String(c._id), { send: vi.fn() }, now)).rejects.toMatchObject({
      code: 'CAMPAIGN_BUSY',
    });
    await CampaignLock.deleteMany({});
    const send = vi.fn().mockRejectedValue(new Error('uncertain'));
    await executeCampaign(String(c._id), { send }, now);
    await executeCampaign(String(c._id), { send }, new Date(+now + 24 * 3600000));
    expect(send).toHaveBeenCalledTimes(1);
    expect((await CampaignRecipient.findOne())?.status).toBe('reconciliation');
  });
  it('stores delivery events and calculates backed analytics only', async () => {
    await contact();
    const c = await active();
    await executeCampaign(String(c._id), { send: async () => ({ id: 'campaign-receipt' }) }, now);
    await recordEmailReceipt(randomUUID(), 'campaign-receipt', 'email.delivered', now);
    await recordEmailReceipt(randomUUID(), 'campaign-receipt', 'email.delivered', now);
    const r = await owner.agent.get(`${base}/${c._id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.metrics).toMatchObject({
      targeted: 1,
      sent: 1,
      delivered: 1,
      issued: 1,
      redeemed: 0,
      redemptionRate: 0,
    });
    expect(r.body.data.metrics.opened).toBeUndefined();
    expect(r.body.data.recipients[0].deliveryEvents[0].type).toBe('email.delivered');
    expect(r.body.data.recipients[0].text).toBeUndefined();
  });
  it('requires a strong independent cron secret', async () => {
    expect((await request(app).get('/api/v1/internal/campaigns/run')).status).toBe(401);
  });
  it('preserves selected audience restrictions across recipient cursor batches', async () => {
    const selected: string[] = [];
    for (let i = 0; i < 5; i++) {
      selected.push(String((await contact())._id));
      await contact();
    }
    const c = await active({ audience: { type: 'selected', contactIds: selected } });
    const provider = { send: vi.fn(async () => ({ id: randomUUID() })) };
    await executeCampaign(String(c._id), provider, now);
    await executeCampaign(String(c._id), provider, new Date(+now + 60000));
    expect(provider.send).toHaveBeenCalledTimes(5);
    const recipients = await CampaignRecipient.find({ campaignId: c._id }).lean();
    expect(recipients.every((r) => selected.includes(String(r.contactId)))).toBe(true);
  });
  it('stops delivery when an owner loses membership and completes zero-audience runs', async () => {
    const c = await active({ trigger: { type: 'once', sendTime: '00:00' } });
    const provider = { send: vi.fn() };
    await executeCampaign(String(c._id), provider, now);
    expect((await Campaign.findById(c._id))?.status).toBe('completed');
    const d = await active();
    await contact();
    await BusinessMembership.updateOne(
      { businessId, userId: owner.id },
      { $set: { status: 'disabled' } },
    );
    await executeCampaign(String(d._id), provider, now);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it('fails closed when the activity intent cannot be persisted', async () => {
    const spy = vi
      .spyOn(AdminAudit, 'create')
      .mockRejectedValueOnce(new Error('Audit unavailable'));
    try {
      await expect(
        createCampaign(campaignInput.parse(input()), businessId, owner.id),
      ).rejects.toThrow('Audit unavailable');
      expect(await Campaign.countDocuments()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    ['Birthday', { type: 'birthday', sendTime: '00:00' }, { birthday: '10-20' }, now],
    [
      'Weekend',
      { type: 'weekly', weekdays: [0, 6], sendTime: '00:00' },
      {},
      new Date('2026-10-24T10:00:00Z'),
    ],
    ['Tuesday', { type: 'weekly', weekdays: [2], sendTime: '00:00' }, {}, now],
    [
      'Welcome',
      { type: 'welcome', sendTime: '00:00' },
      { createdAt: new Date('2026-10-19T10:00:00Z') },
      now,
    ],
    [
      'Inactivity',
      { type: 'inactive', sendTime: '00:00' },
      { lastResponseAt: new Date('2026-01-01T10:00:00Z') },
      now,
    ],
  ] as const)(
    '%s completes the API-to-delivery-to-redemption journey',
    async (name, trigger, profile, clock) => {
      const recipient = await contact(profile, false);
      const consent = await owner.patch(
        `/api/v1/businesses/${businessId}/contacts/${recipient._id}/marketing-email`,
        { state: 'granted', evidence: 'Explicit opt-in recorded at point of sale' },
      );
      expect(consent.status).toBe(200);
      await contact({ businessId: otherBusinessId }, false);
      const created = await owner.post(base, { input: input({ name, trigger }) });
      expect(created.status).toBe(201);
      const id = created.body.data._id;
      const preview = await owner.agent.get(`${base}/${id}`);
      expect(preview.status).toBe(200);
      expect(
        (
          await owner.post(`${base}/${id}/activate`, {
            confirm: true,
            revision: 0,
            confirmedCount: preview.body.data.estimatedRecipients,
          })
        ).status,
      ).toBe(200);
      const send = vi.fn(async () => ({ id: `mock-${name}-${randomUUID()}` }));
      await executeCampaign(id, { send }, clock);
      await executeCampaign(id, { send }, clock);
      expect(send).toHaveBeenCalledTimes(1);
      const message = send.mock.calls[0] as unknown as [
        import('../src/modules/email/email.service').EmailMessage,
      ];
      expect(message[0].unsubscribeUrl).toContain('/public/campaign-unsubscribe/');
      expect(message[0].text).toContain('Unsubscribe');
      const record = (await CampaignRecipient.findOne({ campaignId: id }).lean())!;
      expect(String(record.businessId)).toBe(businessId);
      await recordEmailReceipt(randomUUID(), record.providerMessageId!, 'email.delivered', clock);
      const reward = (await Reward.findOne({ campaignRecipientId: record._id }).lean())!;
      const result = await owner.post(`/api/v1/businesses/${businessId}/rewards/redeem`, {
        code: reward.code,
        requestId: randomUUID(),
        orderTotal: 100,
        orderId: `invoice-${name}`,
      });
      expect(result.status).toBe(201);
      const detail = (await owner.agent.get(`${base}/${id}`)).body.data;
      expect(detail.metrics).toMatchObject({
        sent: 1,
        delivered: 1,
        issued: 1,
        redeemed: 1,
        redemptionRate: 100,
      });
    },
  );
  it('requires explicit consent, supports scanner-safe one-click unsubscribe and refuses staff override', async () => {
    const recipient = await contact({}, false);
    const c = await active();
    const provider = { send: vi.fn() };
    expect(await estimateAudience(c, businessId, now)).toBe(0);
    await executeCampaign(String(c._id), provider, now);
    expect(provider.send).not.toHaveBeenCalled();
    const url = `/api/v1/businesses/${businessId}/contacts/${recipient._id}/marketing-email`;
    expect(
      (
        await staff.patch(url, {
          state: 'granted',
          evidence: 'Customer provided written permission',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await other.patch(url, {
          state: 'granted',
          evidence: 'Customer provided written permission',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner.patch(url, {
          state: 'granted',
          evidence: 'Customer provided written permission',
        })
      ).status,
    ).toBe(200);
    const unsubscribe = `/api/v1/public/campaign-unsubscribe/${unsubscribeToken(recipient.toObject())}`;
    expect((await request(app).get(unsubscribe)).status).toBe(303);
    expect(await marketingAllowed(recipient.toObject())).toBe(true);
    expect(
      (await request(app).post(unsubscribe).type('form').send('List-Unsubscribe=One-Click')).status,
    ).toBe(200);
    expect((await request(app).post(unsubscribe)).status).toBe(200);
    expect(await marketingAllowed(recipient.toObject())).toBe(false);
    expect((await request(app).post(unsubscribe + 'bad')).status).toBe(404);
    expect(
      (
        await owner.patch(url, {
          state: 'granted',
          evidence: 'Trying to override withdrawn permission',
        })
      ).status,
    ).toBe(409);
    expect(
      (await owner.agent.get(`/api/v1/businesses/${businessId}/contacts/${recipient._id}`)).body
        .data.marketingEmail.state,
    ).toBe('revoked');
  });
  it('suppresses retries after unsubscribe and future sends after signed complaint receipts', async () => {
    const recipient = await contact();
    const c = await active();
    const send = vi.fn().mockRejectedValue(new Error('Uncertain'));
    await executeCampaign(String(c._id), { send }, now);
    await request(app).post(
      `/api/v1/public/campaign-unsubscribe/${unsubscribeToken(recipient.toObject())}`,
    );
    await executeCampaign(String(c._id), { send }, new Date(+now + 60000));
    expect(send).toHaveBeenCalledTimes(1);
    const r = (await CampaignRecipient.findOne())!;
    expect(r.errorCode).toBe('MARKETING_SUPPRESSED');
    await MarketingSuppression.deleteMany({});
    await MarketingConsent.updateMany({}, { $set: { state: 'granted' } });
    const d = await active({ offerPolicy: 'parallel' });
    await Reward.updateMany({}, { $set: { status: 'cancelled' } });
    await executeCampaign(String(d._id), { send: async () => ({ id: 'complaint-test' }) }, now);
    await recordEmailReceipt(randomUUID(), 'complaint-test', 'email.complained', now);
    expect(await marketingAllowed(recipient.toObject())).toBe(false);
  });
  it('serializes overlapping offers and prevents stacking two codes on one order', async () => {
    await contact();
    const c = await active();
    const d = await active();
    const send = vi.fn(async () => ({ id: randomUUID() }));
    await executeCampaign(String(c._id), { send }, now);
    await executeCampaign(String(d._id), { send }, now);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await CampaignRecipient.findOne({ campaignId: d._id }))?.errorCode).toBe(
      'OFFER_CONFLICT',
    );
    await Campaign.updateMany({}, { $set: { offerPolicy: 'parallel' } });
    const e = await active({ offerPolicy: 'parallel' });
    await executeCampaign(String(e._id), { send }, now);
    expect(send).toHaveBeenCalledTimes(2);
    const rewards = await Reward.find({ status: 'issued' }).lean();
    await expect(
      redeem(businessId, owner.id, rewards[0]!.code, randomUUID(), 100),
    ).rejects.toMatchObject({ code: 'ORDER_REQUIRED' });
    const results = await Promise.allSettled(
      rewards.map((r) =>
        redeem(businessId, owner.id, r.code, randomUUID(), 100, 'same-real-order'),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await RewardOrderClaim.countDocuments()).toBe(1);
    const winning = (await Reward.findOne({ status: 'redeemed' }).lean())!;
    expect(
      (
        await redeem(
          businessId,
          owner.id,
          winning.code,
          winning.redemption!.requestId,
          100,
          'same-real-order',
        )
      ).duplicate,
    ).toBe(true);
    await expect(
      redeem(
        businessId,
        owner.id,
        winning.code,
        winning.redemption!.requestId,
        100,
        'changed-order',
      ),
    ).rejects.toMatchObject({ code: 'ORDER_REWARD_CONFLICT' });
  });
  it('cancels outstanding offers and blocks suspended-business retries', async () => {
    await contact();
    const c = await active();
    const send = vi.fn(async () => ({ id: randomUUID() }));
    await executeCampaign(String(c._id), { send }, now);
    expect(
      (await owner.post(`${base}/${c._id}/cancel`, { confirm: true, revision: 0 })).status,
    ).toBe(200);
    expect((await Reward.findOne())?.status).toBe('cancelled');
    await executeCampaign(String(c._id), { send }, now);
    expect(send).toHaveBeenCalledTimes(1);
    const d = await active();
    const uncertain = vi.fn().mockRejectedValue(new Error('retry'));
    await executeCampaign(String(d._id), { send: uncertain }, now);
    await Business.updateOne({ _id: businessId }, { $set: { adminState: 'suspended' } });
    await executeCampaign(String(d._id), { send: uncertain }, new Date(+now + 60000));
    expect(uncertain).toHaveBeenCalledTimes(1);
  });
  it('deduplicates DST repeated hours, skips leap birthdays in non-leap years and prevents duplicate contact identities', async () => {
    await contact({ birthday: '11-01' });
    const c = await active({
      timezone: 'America/New_York',
      trigger: { type: 'birthday', sendTime: '01:00', endTime: '03:00' },
    });
    const send = vi.fn(async () => ({ id: randomUUID() }));
    await executeCampaign(String(c._id), { send }, new Date('2026-11-01T05:30:00Z'));
    await executeCampaign(String(c._id), { send }, new Date('2026-11-01T06:30:00Z'));
    expect(send).toHaveBeenCalledTimes(1);
    const leap = await contact({ birthday: '02-29' });
    const d = await active({
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2029-01-01T00:00:00Z',
      trigger: { type: 'birthday', sendTime: '00:00' },
    });
    await executeCampaign(String(d._id), { send }, new Date('2027-02-28T10:00:00Z'));
    await executeCampaign(String(d._id), { send }, new Date('2028-02-29T10:00:00Z'));
    expect(send).toHaveBeenCalledTimes(2);
    await expect(contact({ emailLowercase: leap.emailLowercase })).rejects.toMatchObject({
      code: 11000,
    });
  });
  it('exposes secret-free monitoring only to Super Admin and records authenticated scheduler heartbeats', async () => {
    expect((await owner.agent.get('/api/v1/admin/campaigns/monitoring')).status).toBe(403);
    const secret = 'scheduler-test-secret-'.repeat(3),
      previous = process.env['CRON_SECRET'];
    process.env['CRON_SECRET'] = secret;
    try {
      expect(
        (
          await request(app)
            .get('/api/v1/internal/campaigns/run')
            .set('Authorization', 'Bearer wrong')
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get('/api/v1/internal/campaigns/run')
            .set('Authorization', `Bearer ${secret}`)
        ).status,
      ).toBe(200);
      await User.updateOne({ _id: other.id }, { $set: { platformRole: 'SUPER_ADMIN' } });
      await CampaignLock.create({ _id: 'abandoned-test', token: 'private-lock-token', at: now });
      const r = await other.agent.get('/api/v1/admin/campaigns/monitoring');
      expect(r.status).toBe(200);
      expect(r.body.data.scheduler.completedAt).toBeTruthy();
      expect(JSON.stringify(r.body)).not.toContain(secret);
      expect(JSON.stringify(r.body)).not.toContain('private-lock-token');
    } finally {
      if (previous === undefined) delete process.env['CRON_SECRET'];
      else process.env['CRON_SECRET'] = previous;
    }
  });
  it('uses actual issued offers, rather than suppressed targets, as the redemption denominator', async () => {
    await contact();
    await contact({}, false);
    const c = await active();
    await executeCampaign(String(c._id), { send: async () => ({ id: randomUUID() }) }, now);
    const reward = (await Reward.findOne())!;
    await redeem(businessId, owner.id, reward.code, randomUUID(), 100, 'denominator-order');
    const metrics = (await owner.agent.get(`${base}/${c._id}`)).body.data.metrics;
    expect(metrics).toMatchObject({
      targeted: 2,
      issued: 1,
      redeemed: 1,
      redemptionRate: 100,
      conversionRate: 50,
    });
  });
  it('round trips stored configurations without transport metadata', async () => {
    const c = await active();
    expect(campaignConfig(c).name).toBe(c.name);
    expect('businessId' in campaignConfig(c)).toBe(false);
  });
  it('migrates the legacy reward index safely and is repeatable', async () => {
    await CampaignLock.collection.drop();
    expect(await campaignIndexesReady()).toBe(false);
    await Reward.collection.createIndex(
      { businessId: 1, responseId: 1 },
      { name: 'businessId_1_responseId_1', unique: true },
    );
    await migrateCampaignIndexes();
    await migrateCampaignIndexes();
    expect(await campaignIndexesReady()).toBe(true);
    const names = (await Reward.collection.indexes()).map((i) => i.name);
    expect(names).toContain('business_response_unique');
    expect(names).not.toContain('businessId_1_responseId_1');
    expect(names).not.toContain('campaign_response_migration_guard');
    await contact();
    await contact();
    const c = await active();
    await executeCampaign(String(c._id), { send: async () => ({ id: randomUUID() }) }, now);
    expect(await Reward.countDocuments()).toBe(2);
  });
  it('runs weekly windows independently while respecting total customer limits', async () => {
    await contact();
    const c = await active({
      trigger: { type: 'weekly', weekdays: [2], sendTime: '00:00' },
      perCustomerLimit: 2,
    });
    const provider = { send: vi.fn(async () => ({ id: randomUUID() })) };
    await executeCampaign(String(c._id), provider, now);
    await executeCampaign(String(c._id), provider, now);
    await executeCampaign(String(c._id), provider, new Date('2026-10-27T10:00:00Z'));
    await executeCampaign(String(c._id), provider, new Date('2026-11-03T10:00:00Z'));
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(await CampaignExecution.countDocuments({ campaignId: c._id })).toBe(3);
  });
  it('does not retry deleted customers or removed rewards', async () => {
    const deleted = await contact();
    const retained = await contact();
    const c = await active();
    const send = vi.fn().mockRejectedValue(new Error('Uncertain delivery'));
    await executeCampaign(String(c._id), { send }, now);
    await Contact.deleteOne({ _id: deleted._id });
    await Reward.deleteOne({ contactId: retained._id });
    await executeCampaign(String(c._id), { send }, new Date(+now + 60000));
    expect(send).toHaveBeenCalledTimes(2);
    expect(await CampaignRecipient.countDocuments({ status: 'skipped' })).toBe(2);
  });

  describe('platform campaigns and tenant customers', () => {
    async function platformCampaign() {
      await User.updateOne({ _id: other.id }, { $set: { platformRole: 'SUPER_ADMIN' } });
      const c = await createCampaign(campaignInput.parse(input()), businessId, other.id, true);
      await Campaign.updateOne({ _id: c._id }, { $set: { status: 'active' } });
      return c;
    }
    const sender = () => vi.fn(async () => ({ id: randomUUID() }));
    const run = (id: unknown, send: ReturnType<typeof sender>) =>
      executeCampaign(String(id), { send }, new Date(+now + 60000));

    it('never delivers a legacy platform campaign without owner approval', async () => {
      await contact();
      const c = await platformCampaign();
      await Campaign.collection.updateOne({ _id: c._id }, { $unset: { ownerApproval: '' } });
      const send = sender();
      expect((await run(c._id, send)).processed).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(await CampaignRecipient.countDocuments()).toBe(0);
    });

    it('does not treat a support grant as permission to market to customers', async () => {
      await contact();
      const c = await platformCampaign();
      await activeGrant(other.id, businessId, ['campaigns', 'contacts'], 'write');
      const send = sender();
      await run(c._id, send);
      expect(send).not.toHaveBeenCalled();
      const activate = await other.post(`/api/v1/admin/campaigns/${c._id}/schedule`, {
        confirm: true,
        revision: 0,
        confirmedCount: 1,
      });
      expect([403, 409]).toContain(activate.status);
    });

    it('sends only after the owner approves, respects consent and stops on revocation', async () => {
      await contact();
      await contact({}, false);
      const suppressed = await contact();
      await MarketingSuppression.create({
        businessId,
        email: suppressed.emailLowercase!,
        reason: 'unsubscribe',
        at: now,
      });
      const c = await platformCampaign();
      const url = `${base}/${c._id}/owner-approval`;
      expect((await staff.post(url, { decision: 'approve', confirm: true })).status).toBe(403);
      expect((await other.post(url, { decision: 'approve', confirm: true })).status).toBe(403);
      expect((await owner.post(url, { decision: 'approve' })).status).toBe(422);
      expect((await owner.post(url, { decision: 'approve', confirm: true })).status).toBe(200);
      const send = sender();
      await run(c._id, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect((await owner.post(url, { decision: 'reject', confirm: true })).status).toBe(200);
      const after = sender();
      await executeCampaign(String(c._id), { send: after }, new Date(+now + 24 * 3600000));
      expect(after).not.toHaveBeenCalled();
    });

    it('voids approval when platform staff edit the draft and forbids hand-picked audiences', async () => {
      const c = await createCampaign(campaignInput.parse(input()), businessId, other.id, true);
      await Campaign.updateOne({ _id: c._id }, { $set: { ownerApproval: { status: 'approved' } } });
      await updateCampaign(
        (await Campaign.findById(c._id).lean())!,
        campaignInput.parse(input({ name: 'Changed' })),
        other.id,
        0,
      );
      expect((await Campaign.findById(c._id).lean())?.ownerApproval ?? null).toBeNull();
      await expect(
        createCampaign(
          campaignInput.parse(input({ audience: { type: 'selected', contactIds: [businessId] } })),
          businessId,
          other.id,
          true,
        ),
      ).rejects.toMatchObject({ code: 'AUDIENCE_NOT_ALLOWED' });
    });

    it('reports legacy campaigns for owner review without exposing recipient data', async () => {
      const kept = await contact();
      const c = await platformCampaign();
      await Campaign.collection.updateOne({ _id: c._id }, { $unset: { ownerApproval: '' } });
      await CampaignRecipient.create({
        campaignId: c._id,
        businessId,
        executionId: new mongoose.Types.ObjectId(),
        contactId: kept._id,
        window: '2026-10-19',
        dedupeKey: 'legacy-1',
        status: 'pending',
        startedAt: now,
        email: kept.emailLowercase,
      });
      await MarketingConsent.updateOne({ contactId: kept._id }, { state: 'revoked' });
      const rows = await reviewPlatformCampaigns();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ownerApproval: 'missing',
        deliveryBlocked: true,
        needsOwnerReview: true,
        unsentRecipients: 1,
      });
      expect(JSON.stringify(rows)).not.toContain('customer-');
      expect(rows[0]!.reasons.join(' ')).toMatch(/owner approval/i);
      const api = await other.agent.get('/api/v1/admin/campaigns/owner-review');
      expect(api.status).toBe(200);
      expect(api.body.data).toHaveLength(1);
      expect((await owner.agent.get('/api/v1/admin/campaigns/owner-review')).status).toBe(403);
    });
  });
});
