import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { User } from '../src/modules/auth/user.model';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { hashPassword } from '../src/modules/auth/password';
import { signAccessToken, hashToken, newOpaqueToken } from '../src/modules/auth/tokens';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { AdminAudit } from '../src/modules/admin/admin.model';
import { AdminMutationLock } from '../src/modules/admin/admin.actions';

const app = createApp();
const PASSWORD = 'test-secure-password-123';
let passwordHash = '';
let seq = 0;
beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    Business.deleteMany({}),
    BusinessMembership.deleteMany({}),
    AdminAudit.deleteMany({}),
    AdminMutationLock.deleteMany({}),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
});
async function client(admin = false) {
  const user = await User.create({
    fullName: 'Permission test',
    emailLowercase: `permission-${++seq}@example.test`,
    passwordHash,
    platformRole: admin ? 'SUPER_ADMIN' : 'USER',
  });
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  const login = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', csrf)
    .send({ email: user.emailLowercase, password: PASSWORD });
  expect(login.status).toBe(200);
  return {
    user,
    agent,
    csrf,
    get: (url: string) => agent.get(url),
    post: (url: string, body: object) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    patch: (url: string, body: object) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    remove: (url: string) => agent.delete(url).set('X-CSRF-Token', csrf).send({ confirm: true }),
  };
}
async function business(owner: Awaited<ReturnType<typeof client>>) {
  const b = await Business.create({
    ownerUserId: owner.user._id,
    createRequestId: randomUUID(),
    name: 'Permission business',
    category: 'Cafe',
    timezone: 'UTC',
    slug: `permission-${randomUUID()}`,
  });
  const membership = await BusinessMembership.create({
    businessId: b._id,
    userId: owner.user._id,
    role: 'owner',
  });
  return { b, membership, url: `/api/v1/admin/businesses/${b._id}` };
}

describe('complete account permission lifecycle', () => {
  it('blocks real login, access and refresh; unblocking never revives old sessions', async () => {
    const admin = await client(true);
    const target = await client();
    const url = `/api/v1/admin/users/${target.user._id}/action`;
    expect((await admin.post(url, { action: 'block', confirm: true })).status).toBe(200);
    expect((await target.get('/api/v1/me')).status).toBe(401);
    expect((await target.post('/api/v1/auth/refresh', {})).status).toBe(401);
    expect(
      (
        await target.post('/api/v1/auth/login', {
          email: target.user.emailLowercase,
          password: PASSWORD,
        })
      ).status,
    ).toBe(401);
    expect((await admin.post(url, { action: 'unblock', confirm: true })).status).toBe(200);
    expect((await target.get('/api/v1/me')).status).toBe(401);
    expect((await target.post('/api/v1/auth/refresh', {})).status).toBe(401);
    expect(
      (
        await target.post('/api/v1/auth/login', {
          email: target.user.emailLowercase,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    expect((await target.get('/api/v1/me')).status).toBe(200);
    expect(
      await AdminAudit.countDocuments({ targetId: target.user._id, outcome: 'completed' }),
    ).toBe(2);
  });
  it('revoke invalidates both token kinds but allows a new login', async () => {
    const admin = await client(true);
    const target = await client();
    expect(
      (
        await admin.post(`/api/v1/admin/users/${target.user._id}/action`, {
          action: 'revoke-sessions',
          confirm: true,
        })
      ).status,
    ).toBe(200);
    expect((await target.get('/api/v1/me')).status).toBe(401);
    expect((await target.post('/api/v1/auth/refresh', {})).status).toBe(401);
    expect(
      (
        await target.post('/api/v1/auth/login', {
          email: target.user.emailLowercase,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    expect((await target.get('/api/v1/me')).status).toBe(200);
    // Simulate a refresh document created by an in-flight rotation after bulk family revocation.
    const lateRefresh = newOpaqueToken();
    await RefreshToken.create({
      userId: target.user._id,
      familyId: randomUUID(),
      tokenHash: hashToken(lateRefresh),
      sessionVersion: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', `gdv_rt=${lateRefresh}; gdv_csrf=late`)
          .set('X-CSRF-Token', 'late')
          .send({})
      ).status,
    ).toBe(401);
    const token = signAccessToken(String(target.user._id), 0);
    expect((await request(app).get('/api/v1/me').set('Cookie', `gdv_at=${token}`)).status).toBe(
      401,
    );
  });
  it('changes platform roles only through authorized, confirmed requests and revokes prior sessions', async () => {
    const admin = await client(true);
    const target = await client();
    const other = await client();
    const url = `/api/v1/admin/users/${target.user._id}/role`;
    expect((await other.patch(url, { platformRole: 'SUPER_ADMIN', confirm: true })).status).toBe(
      403,
    );
    expect((await admin.patch(url, { platformRole: 'SUPER_ADMIN' })).status).toBe(422);
    expect((await admin.patch(url, { platformRole: 'SUPER_ADMIN', confirm: true })).status).toBe(
      200,
    );
    expect((await target.get('/api/v1/admin/users')).status).toBe(401);
    await target.post('/api/v1/auth/login', {
      email: target.user.emailLowercase,
      password: PASSWORD,
    });
    expect((await target.get('/api/v1/admin/users')).status).toBe(200);
    expect((await admin.patch(url, { platformRole: 'USER', confirm: true })).status).toBe(200);
    expect((await target.get('/api/v1/admin/users')).status).toBe(401);
    await target.post('/api/v1/auth/login', {
      email: target.user.emailLowercase,
      password: PASSWORD,
    });
    expect((await target.get('/api/v1/admin/users')).status).toBe(403);
    expect(
      await AdminAudit.countDocuments({ action: 'PLATFORM_ROLE_CHANGED', outcome: 'completed' }),
    ).toBe(2);
  });
  it('manages other Super Admins while protecting self and the last active administrator', async () => {
    const admin = await client(true);
    const other = await client(true);
    const self = `/api/v1/admin/users/${admin.user._id}`;
    expect((await admin.post(`${self}/action`, { action: 'block', confirm: true })).status).toBe(
      409,
    );
    expect(
      (await admin.post(`${self}/action`, { action: 'revoke-sessions', confirm: true })).status,
    ).toBe(409);
    expect(
      (await admin.patch(`${self}/role`, { platformRole: 'USER', confirm: true })).status,
    ).toBe(409);
    expect(
      (
        await admin.post(`/api/v1/admin/users/${other.user._id}/action`, {
          action: 'block',
          confirm: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.post(`/api/v1/admin/users/${String(admin.user._id).toUpperCase()}/action`, {
          action: 'block',
          confirm: true,
        })
      ).status,
    ).toBe(409);
    expect((await admin.get('/api/v1/admin/users')).status).toBe(200);
    expect((await other.get('/api/v1/admin/users')).status).toBe(401);
  });
  it('serializes competing admin lockout requests', async () => {
    const a = await client(true);
    const b = await client(true);
    const results = await Promise.all([
      a.post(`/api/v1/admin/users/${b.user._id}/action`, { action: 'block', confirm: true }),
      b.post(`/api/v1/admin/users/${a.user._id}/action`, { action: 'block', confirm: true }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await User.countDocuments({ platformRole: 'SUPER_ADMIN', status: 'active' })).toBe(1);
  });
});
describe('membership permissions and owner invariants', () => {
  it('promotes/demotes business owners, updates the primary owner and immediately removes access', async () => {
    const admin = await client(true);
    const owner = await client();
    const staff = await client();
    const { b, membership, url } = await business(owner);
    const staffMember = await BusinessMembership.create({
      businessId: b._id,
      userId: staff.user._id,
      role: 'member',
    });
    expect((await staff.patch(`/api/v1/businesses/${b._id}`, { name: 'No' })).status).toBe(403);
    expect(
      (await admin.patch(`${url}/members/${staffMember._id}`, { role: 'owner', confirm: true }))
        .status,
    ).toBe(200);
    expect((await staff.patch(`/api/v1/businesses/${b._id}`, { name: 'Owner edit' })).status).toBe(
      200,
    );
    expect(
      (await admin.patch(`${url}/members/${membership._id}`, { role: 'member', confirm: true }))
        .status,
    ).toBe(200);
    expect(String((await Business.findById(b._id).lean())?.ownerUserId)).toBe(
      String(staff.user._id),
    );
    expect((await owner.patch(`/api/v1/businesses/${b._id}`, { name: 'No' })).status).toBe(403);
    expect((await admin.remove(`${url}/members/${membership._id}`)).status).toBe(200);
    expect((await owner.get(`/api/v1/businesses/${b._id}`)).status).toBe(403);
    expect((await owner.get('/api/v1/businesses')).body.data.businesses).toHaveLength(0);
    expect(
      await AdminAudit.countDocuments({ action: 'BUSINESS_ROLE_CHANGED', outcome: 'completed' }),
    ).toBe(2);
  });
  it('cannot remove, demote, or disable the last owner; a second owner permits removal', async () => {
    const admin = await client(true);
    const owner = await client();
    const other = await client();
    const { b, membership, url } = await business(owner);
    const target = `${url}/members/${membership._id}`;
    expect((await admin.remove(target)).status).toBe(409);
    expect((await admin.patch(target, { role: 'member', confirm: true })).status).toBe(409);
    expect((await admin.patch(target, { status: 'disabled', confirm: true })).status).toBe(409);
    await BusinessMembership.create({ businessId: b._id, userId: other.user._id, role: 'owner' });
    expect((await admin.remove(target)).status).toBe(200);
    expect(await BusinessMembership.countDocuments({ businessId: b._id, role: 'owner' })).toBe(1);
    expect(String((await Business.findById(b._id).lean())?.ownerUserId)).toBe(
      String(other.user._id),
    );
  });
  it('never demotes both owners concurrently', async () => {
    const admin = await client(true);
    const owner = await client();
    const other = await client();
    const { b, membership, url } = await business(owner);
    const second = await BusinessMembership.create({
      businessId: b._id,
      userId: other.user._id,
      role: 'owner',
    });
    const results = await Promise.all([
      admin.patch(`${url}/members/${membership._id}`, { role: 'member', confirm: true }),
      admin.patch(`/api/v1/admin/businesses/${String(b._id).toUpperCase()}/members/${second._id}`, {
        role: 'member',
        confirm: true,
      }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await BusinessMembership.countDocuments({ businessId: b._id, role: 'owner' })).toBe(1);
  });
  it('rejects tenant mismatches, role escalation, unconfirmed deletes and missing CSRF', async () => {
    const admin = await client(true);
    const owner = await client();
    const staff = await client();
    const a = await business(owner);
    const b = await business(staff);
    const target = `${a.url}/members/${b.membership._id}`;
    expect((await admin.patch(target, { role: 'owner', confirm: true })).status).toBe(404);
    expect((await admin.remove(target)).status).toBe(404);
    expect(
      (await owner.patch(`${a.url}/members/${a.membership._id}`, { role: 'owner', confirm: true }))
        .status,
    ).toBe(403);
    expect(
      (
        await admin.patch(`${a.url}/members/${a.membership._id}`, {
          role: 'SUPER_ADMIN',
          confirm: true,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await admin.agent
          .delete(`${a.url}/members/${a.membership._id}`)
          .set('X-CSRF-Token', admin.csrf)
          .send({})
      ).status,
    ).toBe(422);
    expect(
      (
        await admin.agent
          .post(`/api/v1/admin/users/${staff.user._id}/action`)
          .send({ action: 'block', confirm: true })
      ).status,
    ).toBe(403);
  });
  it('reactivates legacy disabled businesses without completing onboarding', async () => {
    const admin = await client(true);
    const owner = await client();
    const { b, url } = await business(owner);
    await Business.updateOne({ _id: b._id }, { status: 'disabled' });
    expect((await owner.get(`/api/v1/businesses/${b._id}`)).status).toBe(403);
    expect((await admin.post(`${url}/state`, { state: 'active', confirm: true })).status).toBe(200);
    const stored = await Business.findById(b._id).lean();
    expect(stored?.status).toBe('onboarding');
    expect(stored?.onboarding?.completedAt).toBeNull();
    expect((await owner.get(`/api/v1/businesses/${b._id}`)).status).toBe(200);
    expect((await admin.post(`${url}/state`, { state: 'suspended', confirm: true })).status).toBe(
      200,
    );
    expect((await owner.get(`/api/v1/businesses/${b._id}`)).status).toBe(403);
  });
});

it('fails closed on an unresolved ownership lock and audits the failed attempt', async () => {
  const admin = await client(true);
  const owner = await client();
  const { b, membership, url } = await business(owner);
  await AdminMutationLock.create({
    _id: `business:${b._id}`,
    token: new mongoose.Types.ObjectId(),
    acquiredAt: new Date(),
  });
  const result = await admin.remove(`${url}/members/${membership._id}`);
  expect(result.status).toBe(409);
  expect(result.body.error.code).toBe('ADMIN_ACTION_IN_PROGRESS');
  expect(await BusinessMembership.exists({ _id: membership._id })).not.toBeNull();
  expect(await AdminAudit.countDocuments({ targetId: membership._id, outcome: 'failed' })).toBe(1);
});

it('removing access in one tenant preserves the same account access in another', async () => {
  const admin = await client(true);
  const ownerA = await client();
  const ownerB = await client();
  const staff = await client();
  const a = await business(ownerA);
  const b = await business(ownerB);
  const memberA = await BusinessMembership.create({
    businessId: a.b._id,
    userId: staff.user._id,
    role: 'member',
  });
  await BusinessMembership.create({ businessId: b.b._id, userId: staff.user._id, role: 'member' });
  expect((await admin.remove(`${a.url}/members/${memberA._id}`)).status).toBe(200);
  expect((await staff.get(`/api/v1/businesses/${a.b._id}`)).status).toBe(403);
  expect((await staff.get(`/api/v1/businesses/${b.b._id}`)).status).toBe(200);
  expect((await staff.get('/api/v1/me')).status).toBe(200);
});
