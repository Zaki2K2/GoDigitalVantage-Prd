import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { User } from '../src/modules/auth/user.model';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { AdminAudit } from '../src/modules/admin/admin.model';
import { signAccessToken } from '../src/modules/auth/tokens';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { Questionnaire } from '../src/modules/questionnaires/questionnaire.model';
import { Reward } from '../src/modules/rewards/reward.model';
import { loadPublished } from '../src/modules/questionnaires/questionnaire.service';
import { AdminReauth, SupportGrant } from '../src/modules/admin/support.model';
import { activeGrant, reauth } from './support-helpers';

const app = createApp();
let seq = 0;
async function client(admin = false) {
  const user = await User.create({
    fullName: admin ? 'Platform admin' : 'Business owner',
    emailLowercase: `admin-test-${++seq}@example.com`,
    passwordHash: 'private-hash',
    platformRole: admin ? 'SUPER_ADMIN' : 'USER',
  });
  const token = signAccessToken(String(user._id));
  const cookie = `gdv_at=${token}; gdv_csrf=test-csrf`;
  return {
    user,
    token,
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string, body: object) =>
      request(app).post(url).set('Cookie', cookie).set('X-CSRF-Token', 'test-csrf').send(body),
    patch: (url: string, body: object) =>
      request(app).patch(url).set('Cookie', cookie).set('X-CSRF-Token', 'test-csrf').send(body),
    delete: (url: string) =>
      request(app)
        .delete(url)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', 'test-csrf')
        .send({ confirm: true }),
  };
}
async function business(owner: Awaited<ReturnType<typeof client>>, name = 'Alpha Cafe') {
  const b = await Business.create({
    ownerUserId: owner.user._id,
    createRequestId: randomUUID(),
    name,
    category: 'Cafe',
    timezone: 'UTC',
    slug: randomUUID(),
  });
  await BusinessMembership.create({ businessId: b._id, userId: owner.user._id, role: 'owner' });
  return b;
}
beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    BusinessMembership.deleteMany({}),
    AdminAudit.deleteMany({}),
    SupportGrant.deleteMany({}),
    AdminReauth.deleteMany({}),
    RefreshToken.deleteMany({}),
    Questionnaire.deleteMany({}),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
});

describe('platform authorization and safe reads', () => {
  it('denies anonymous, normal user and business owner across every admin section', async () => {
    const owner = await client();
    await business(owner);
    for (const path of [
      'dashboard',
      'businesses',
      'users',
      'forms',
      'responses',
      'contacts',
      'promotions',
      'activity',
      'system',
      'search',
    ]) {
      expect((await request(app).get(`/api/v1/admin/${path}`)).status).toBe(401);
      expect((await owner.get(`/api/v1/admin/${path}`)).status).toBe(403);
    }
  });
  it('reads current privileges and excludes authentication and internal fields', async () => {
    const admin = await client(true);
    const user = await client();
    const res = await admin.get('/api/v1/admin/users');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|private-hash|sessionsRevokedAt|tokenHash/,
    );
    expect((await admin.get(`/api/v1/admin/users/${user.user._id}`)).body.data.businessCount).toBe(
      0,
    );
    await User.updateOne({ _id: admin.user._id }, { platformRole: 'USER' });
    expect((await admin.get('/api/v1/admin/users')).status).toBe(403);
  });
  it('validates IDs, dates, pagination and missing records', async () => {
    const admin = await client(true);
    expect((await admin.get('/api/v1/admin/businesses/not-an-id')).status).toBe(422);
    expect((await admin.get('/api/v1/admin/businesses/aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(404);
    expect((await admin.get('/api/v1/admin/businesses?pageSize=10000')).status).toBe(422);
    expect((await admin.get('/api/v1/admin/forms?from=bad')).status).toBe(422);
  });
  it('paginates, filters and escapes search; finds businesses by owner', async () => {
    const admin = await client(true);
    const owner = await client();
    const a = await business(owner, 'Alpha');
    await business(owner, 'Beta');
    await Business.updateOne({ _id: a._id }, { adminState: 'suspended' });
    const page = await admin.get('/api/v1/admin/businesses?pageSize=1&page=2');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination.total).toBe(2);
    expect((await admin.get('/api/v1/admin/businesses?search=alpha')).body.data[0].name).toBe(
      'Alpha',
    );
    expect(
      (await admin.get('/api/v1/admin/businesses?search=Business%20owner')).body.pagination.total,
    ).toBe(2);
    expect(
      (await admin.get('/api/v1/admin/businesses?status=suspended')).body.pagination.total,
    ).toBe(1);
    expect((await admin.get('/api/v1/admin/businesses?search=.*')).body.pagination.total).toBe(0);
    expect((await admin.get('/api/v1/admin/users?role=owner')).body.pagination.total).toBe(1);
  });
  it('keeps normal business membership checks in place even for a super admin', async () => {
    const admin = await client(true);
    const owner = await client();
    const b = await business(owner);
    expect((await admin.get(`/api/v1/businesses/${b._id}`)).status).toBe(403);
    expect((await admin.get(`/api/v1/admin/businesses/${b._id}`)).status).toBe(200);
  });
});
describe('privileged mutations', () => {
  it('suspends and restores membership/public-form access and creates an audit', async () => {
    const admin = await client(true);
    const owner = await client();
    const b = await business(owner);
    const url = `/api/v1/admin/businesses/${b._id}/state`;
    expect((await owner.post(url, { state: 'suspended', confirm: true })).status).toBe(403);
    expect((await admin.post(url, { state: 'suspended' })).status).toBe(422);
    expect((await admin.post(url, { state: 'suspended', confirm: true })).status).toBe(200);
    expect((await owner.get(`/api/v1/businesses/${b._id}`)).status).toBe(403);
    await expect(loadPublished(b.slug)).rejects.toMatchObject({ code: 'FORM_UNAVAILABLE' });
    const log = await AdminAudit.findOne({ action: 'BUSINESS_SUSPENDED' }).lean();
    expect(log?.actorUserId.toString()).toBe(String(admin.user._id));
    expect(log?.outcome).toBe('completed');
    expect((await admin.post(url, { state: 'active', confirm: true })).status).toBe(200);
    expect((await owner.get(`/api/v1/businesses/${b._id}`)).status).toBe(200);
  });
  it('keeps CSRF protection on admin mutations', async () => {
    const admin = await client(true);
    const b = await business(admin);
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/businesses/${b._id}/state`)
          .set('Cookie', `gdv_at=${admin.token}`)
          .send({ state: 'suspended', confirm: true })
      ).status,
    ).toBe(403);
  });
  it('edits metadata but cannot alter slug, owner or platform roles through mass assignment', async () => {
    const admin = await client(true);
    const owner = await client();
    const b = await business(owner);
    expect(
      (await admin.patch(`/api/v1/admin/businesses/${b._id}`, { name: 'Updated' })).status,
    ).toBe(403);
    await activeGrant(admin.user._id, b._id, ['business_profile'], 'write');
    await reauth(admin.user._id);
    expect(
      (await admin.patch(`/api/v1/admin/businesses/${b._id}`, { name: 'Updated' })).status,
    ).toBe(200);
    expect(
      (await admin.patch(`/api/v1/admin/businesses/${b._id}`, { slug: 'changed' })).status,
    ).toBe(422);
    expect(
      (
        await admin.post(`/api/v1/admin/users/${owner.user._id}/action`, {
          action: 'enable',
          platformRole: 'SUPER_ADMIN',
          confirm: true,
        })
      ).status,
    ).toBe(422);
  });
  it('disables and reenables accounts, revokes cookies immediately and protects admins', async () => {
    const admin = await client(true);
    const user = await client();
    const url = `/api/v1/admin/users/${user.user._id}/action`;
    expect((await admin.post(url, { action: 'disable', confirm: true })).status).toBe(200);
    expect((await user.get('/api/v1/me')).status).toBe(401);
    expect((await admin.post(url, { action: 'enable', confirm: true })).status).toBe(200);
    expect((await user.get('/api/v1/me')).status).toBe(401);
    expect(
      (
        await admin.post(`/api/v1/admin/users/${admin.user._id}/action`, {
          action: 'disable',
          confirm: true,
        })
      ).status,
    ).toBe(409);
    const fresh = signAccessToken(
      String(user.user._id),
      (await User.findById(user.user._id).lean())?.sessionVersion ?? 0,
    );
    expect((await request(app).get('/api/v1/me').set('Cookie', `gdv_at=${fresh}`)).status).toBe(
      200,
    );
  });
  it('revokes sessions without disabling account and rejects old refresh tokens', async () => {
    const admin = await client(true);
    const user = await client();
    await RefreshToken.create({
      userId: user.user._id,
      familyId: randomUUID(),
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(
      (
        await admin.post(`/api/v1/admin/users/${user.user._id}/action`, {
          action: 'revoke-sessions',
          confirm: true,
        })
      ).status,
    ).toBe(200);
    expect((await user.get('/api/v1/me')).status).toBe(401);
    expect((await RefreshToken.findOne({ userId: user.user._id }).lean())?.familyRevoked).toBe(
      true,
    );
    expect((await User.findById(user.user._id).lean())?.status).toBe('active');
  });
  it('never removes an owner or a membership from the wrong business', async () => {
    const admin = await client(true);
    const owner = await client();
    const b = await business(owner);
    const other = await business(owner, 'Other');
    const ownerMembership = await BusinessMembership.findOne({ businessId: b._id });
    expect(
      (await admin.delete(`/api/v1/admin/businesses/${b._id}/members/${ownerMembership!._id}`))
        .status,
    ).toBe(409);
    const member = await BusinessMembership.create({
      businessId: b._id,
      userId: admin.user._id,
      role: 'member',
    });
    expect(
      (await admin.delete(`/api/v1/admin/businesses/${other._id}/members/${member._id}`)).status,
    ).toBe(404);
    expect(
      (await admin.delete(`/api/v1/admin/businesses/${b._id}/members/${member._id}`)).status,
    ).toBe(200);
  });
  it('fails closed if the audit intent cannot be written', async () => {
    const admin = await client(true);
    const owner = await client();
    const b = await business(owner);
    // A missing actor snapshot makes the required audit fail validation before the mutation.
    await User.updateOne({ _id: admin.user._id }, { $unset: { fullName: 1 } });
    expect(
      (
        await admin.post(`/api/v1/admin/businesses/${b._id}/state`, {
          state: 'archived',
          confirm: true,
        })
      ).status,
    ).toBe(500);
    expect((await Business.findById(b._id).lean())?.adminState).toBe('active');
  });
});

describe('forms and memberships', () => {
  it('publishes through existing revision validation and archives/restores without deleting versions', async () => {
    const admin = await client(true);
    const owner = await client();
    const b = await business(owner);
    const form = await Questionnaire.create({
      businessId: b._id,
      draft: {
        title: 'Feedback',
        description: null,
        questions: [
          {
            id: 'rating',
            type: 'rating',
            label: 'Rate us',
            required: true,
            choices: [],
            helpText: null,
          },
        ],
      },
    });
    const url = `/api/v1/admin/forms/${form._id}`;
    const grant = await activeGrant(admin.user._id, b._id, ['forms'], 'write');
    await reauth(admin.user._id);
    const publishUrl = `/api/v1/admin/support/${grant._id}/forms/${form._id}/publish`;
    expect(
      (await admin.post(`${url}/publish`, { confirm: true, expectedRevision: 1 })).status,
    ).toBe(422);
    expect((await admin.post(publishUrl, { confirm: true, expectedRevision: 999 })).status).toBe(
      409,
    );
    expect((await admin.post(publishUrl, { confirm: true, expectedRevision: 1 })).status).toBe(200);
    const published = await loadPublished(b.slug);
    expect(published.version.version).toBe(1);
    expect((await admin.post(`${url}/archive`, { confirm: true })).status).toBe(200);
    await expect(loadPublished(b.slug)).rejects.toMatchObject({ code: 'FORM_UNAVAILABLE' });
    expect((await admin.post(`${url}/restore`, { confirm: true })).status).toBe(200);
    expect((await loadPublished(b.slug)).version._id.toString()).toBe(
      published.version._id.toString(),
    );
    expect((await admin.get(`${url}/versions`)).body.data).toHaveLength(1);
    expect(
      (
        await AdminAudit.findOne({ action: 'FORM_PUBLISH_UNDER_GRANT', outcome: 'failed' }).lean()
      )?.targetId.toString(),
    ).toBe(String(form._id));
  });
  it('disables/enables non-owner memberships and supports membership search', async () => {
    const admin = await client(true);
    const owner = await client();
    const staff = await client();
    const b = await business(owner);
    const membership = await BusinessMembership.create({
      businessId: b._id,
      userId: staff.user._id,
      role: 'member',
    });
    const url = `/api/v1/admin/businesses/${b._id}/members/${membership._id}`;
    expect((await admin.patch(url, { status: 'disabled', confirm: true })).status).toBe(200);
    expect((await staff.get(`/api/v1/businesses/${b._id}`)).status).toBe(403);
    expect((await admin.patch(url, { status: 'active', confirm: true })).status).toBe(200);
    expect((await staff.get(`/api/v1/businesses/${b._id}`)).status).toBe(200);
    expect(
      (await admin.get(`/api/v1/admin/businesses/${b._id}/members?search=nomatch`)).body.pagination
        .total,
    ).toBe(0);
    expect(
      (await admin.get(`/api/v1/admin/users/${owner.user._id}/memberships?search=Alpha`)).body.data,
    ).toHaveLength(1);
  });
  it('returns QR SVG and PNG through guarded admin routes', async () => {
    const admin = await client(true);
    const owner = await client();
    const b = await business(owner);
    const url = `/api/v1/admin/businesses/${b._id}/qr`;
    expect((await admin.get(`${url}.svg`)).headers['content-type']).toContain('image/svg+xml');
    expect((await admin.get(`${url}.png`)).headers['content-type']).toContain('image/png');
    expect((await owner.get(`${url}.svg`)).status).toBe(403);
  });
});

it('uses supported promotion transitions, hides identity hashes, and audits failed decisions', async () => {
  const admin = await client(true);
  const owner = await client();
  const b = await business(owner);
  const reward = await Reward.create({
    businessId: b._id,
    ruleId: new mongoose.Types.ObjectId(),
    ruleName: 'QA rule',
    responseId: new mongoose.Types.ObjectId(),
    code: `GDV-${randomUUID()}`,
    status: 'pending_approval',
    discountType: 'percent',
    discountValue: 10,
    currency: 'USD',
    validityDays: 7,
    identityHash: 'private-identity-hash',
  });
  const grant = await activeGrant(admin.user._id, b._id, ['rewards'], 'write');
  await reauth(admin.user._id);
  const url = `/api/v1/admin/support/${grant._id}/rewards/${reward._id}`;
  const detail = await admin.get(`/api/v1/admin/support/${grant._id}/rewards`);
  expect(detail.status).toBe(200);
  expect(JSON.stringify(detail.body)).not.toMatch(/identityHash|private-identity-hash/);
  expect((await owner.post(`${url}/approve`, { confirm: true })).status).toBe(403);
  expect((await admin.post(`${url}/approve`, { confirm: true })).status).toBe(200);
  expect((await admin.post(`${url}/reject`, { confirm: true })).status).toBe(409);
  expect((await admin.post(`${url}/cancel`, { confirm: true })).status).toBe(200);
  expect((await Reward.findById(reward._id).lean())?.status).toBe('cancelled');
  expect(
    (
      await AdminAudit.findOne({
        targetId: reward._id,
        action: 'PROMOTION_REJECT_UNDER_GRANT',
      }).lean()
    )?.outcome,
  ).toBe('failed');
});
