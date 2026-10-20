import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { User } from '../src/modules/auth/user.model';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { ProfileImage } from '../src/modules/images/image.model';

const PASSWORD = 'correct-horse-battery';
let seq = 0;

// Minimal valid signatures; the API checks real magic bytes, not the declared type.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(16),
]);

async function newUser() {
  const agent = request.agent(createApp());
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  const res = await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({
      fullName: 'Img User',
      email: `img${++seq}-${Date.now()}@example.com`,
      password: PASSWORD,
    });
  const put = (url: string, body: Buffer, type = 'image/png') =>
    agent.put(url).set('X-CSRF-Token', csrf).set('Content-Type', type).send(body);
  return {
    agent,
    csrf,
    userId: res.body.data.user.id as string,
    user: res.body.data.user as { avatarUrl: string | null },
    put,
    del: (url: string) => agent.delete(url).set('X-CSRF-Token', csrf),
    post: (url: string, body: object = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
  };
}
type Client = Awaited<ReturnType<typeof newUser>>;

async function createBiz(c: Client) {
  const res = await c.post('/api/v1/businesses', {
    createRequestId: randomUUID(),
    name: 'Logo Cafe',
    category: 'Cafe',
    timezone: 'America/New_York',
  });
  return res.body.data.business as { id: string; slug: string; logoUrl: string | null };
}

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  await Promise.all([User.init(), Business.init(), BusinessMembership.init(), ProfileImage.init()]);
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    Business.deleteMany({}),
    BusinessMembership.deleteMany({}),
    ProfileImage.deleteMany({}),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
});

describe('user avatar', () => {
  it('existing users without an image have a null avatar and 404 on fetch', async () => {
    const c = await newUser();
    expect(c.user.avatarUrl).toBeNull();
    expect((await c.agent.get('/api/v1/users/me/avatar')).status).toBe(404);
  });

  it('uploads, serves, replaces and removes', async () => {
    const c = await newUser();
    const up = await c.put('/api/v1/users/me/avatar', PNG);
    expect(up.status).toBe(200);
    expect(up.body.data.avatarUrl).toMatch(/^\/api\/v1\/users\/me\/avatar\?v=\d+$/);

    const got = await c.agent.get('/api/v1/users/me/avatar');
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['cache-control']).toContain('private');
    expect(Buffer.compare(got.body, PNG)).toBe(0);

    expect((await c.agent.get('/api/v1/me')).body.data.user.avatarUrl).toBe(up.body.data.avatarUrl);

    expect((await c.put('/api/v1/users/me/avatar', JPEG, 'image/jpeg')).status).toBe(200);
    expect(await ProfileImage.countDocuments({ ownerType: 'user' })).toBe(1);
    expect((await c.agent.get('/api/v1/users/me/avatar')).headers['content-type']).toBe(
      'image/jpeg',
    );

    expect((await c.del('/api/v1/users/me/avatar')).status).toBe(204);
    expect((await c.agent.get('/api/v1/users/me/avatar')).status).toBe(404);
    expect((await c.agent.get('/api/v1/me')).body.data.user.avatarUrl).toBeNull();
  });

  it('rejects non-images, spoofed types, empty and oversized bodies', async () => {
    const c = await newUser();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await c.put('/api/v1/users/me/avatar', svg, 'image/svg+xml')).status).toBe(415);
    expect((await c.put('/api/v1/users/me/avatar', svg, 'image/png')).status).toBe(415);
    expect((await c.put('/api/v1/users/me/avatar', Buffer.alloc(0))).status).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    const res = await c.put('/api/v1/users/me/avatar', big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await ProfileImage.countDocuments()).toBe(0);
  });

  it('requires authentication and the CSRF header', async () => {
    const anon = request(createApp());
    expect((await anon.get('/api/v1/users/me/avatar')).status).toBe(401);
    const c = await newUser();
    const noCsrf = await c.agent
      .put('/api/v1/users/me/avatar')
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(noCsrf.status).toBe(403);
  });

  it('one user cannot change another user’s avatar', async () => {
    const a = await newUser();
    const b = await newUser();
    await a.put('/api/v1/users/me/avatar', PNG);
    await b.put('/api/v1/users/me/avatar', WEBP, 'image/webp');
    // Each user only ever addresses their own avatar.
    expect((await a.agent.get('/api/v1/users/me/avatar')).headers['content-type']).toBe(
      'image/png',
    );
    expect((await b.agent.get('/api/v1/users/me/avatar')).headers['content-type']).toBe(
      'image/webp',
    );
  });

  it('platform admins can view any avatar; others cannot', async () => {
    const admin = await newUser();
    const user = await newUser();
    await user.put('/api/v1/users/me/avatar', PNG);
    expect((await admin.agent.get(`/api/v1/admin/users/${user.userId}/avatar`)).status).toBe(403);
    await User.updateOne({ _id: admin.userId }, { platformRole: 'SUPER_ADMIN' });
    const res = await admin.agent.get(`/api/v1/admin/users/${user.userId}/avatar`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });
});

describe('business logo', () => {
  it('existing businesses have a null logoUrl and 404 on fetch', async () => {
    const owner = await newUser();
    const biz = await createBiz(owner);
    expect(biz.logoUrl).toBeNull();
    expect((await owner.agent.get(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(404);
  });

  it('owner uploads, replaces and removes; DTO reflects it', async () => {
    const owner = await newUser();
    const biz = await createBiz(owner);
    const up = await owner.put(`/api/v1/businesses/${biz.id}/logo`, PNG);
    expect(up.status).toBe(200);
    expect(up.body.data.logoUrl).toContain(`/api/v1/businesses/${biz.id}/logo?v=`);

    const detail = await owner.agent.get(`/api/v1/businesses/${biz.id}`);
    expect(detail.body.data.business.logoUrl).toBe(up.body.data.logoUrl);
    const got = await owner.agent.get(`/api/v1/businesses/${biz.id}/logo`);
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body, PNG)).toBe(0);

    expect((await owner.put(`/api/v1/businesses/${biz.id}/logo`, WEBP, 'image/webp')).status).toBe(
      200,
    );
    expect(await ProfileImage.countDocuments({ ownerType: 'business' })).toBe(1);

    expect((await owner.del(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(204);
    expect((await owner.agent.get(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(404);
    const after = await owner.agent.get(`/api/v1/businesses/${biz.id}`);
    expect(after.body.data.business.logoUrl).toBeNull();
  });

  it('members may view but not change; outsiders have no access', async () => {
    const owner = await newUser();
    const member = await newUser();
    const outsider = await newUser();
    const biz = await createBiz(owner);
    await owner.put(`/api/v1/businesses/${biz.id}/logo`, PNG);
    await BusinessMembership.create({ businessId: biz.id, userId: member.userId, role: 'member' });

    expect((await member.agent.get(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(200);
    expect((await member.put(`/api/v1/businesses/${biz.id}/logo`, JPEG, 'image/jpeg')).status).toBe(
      403,
    );
    expect((await member.del(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(403);

    expect((await outsider.agent.get(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(403);
    expect(
      (await outsider.put(`/api/v1/businesses/${biz.id}/logo`, JPEG, 'image/jpeg')).status,
    ).toBe(403);
    expect((await outsider.del(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(403);
    expect((await ProfileImage.findOne({ ownerType: 'business' }))?.contentType).toBe('image/png');
  });

  it('rejects invalid uploads without touching the existing logo', async () => {
    const owner = await newUser();
    const biz = await createBiz(owner);
    await owner.put(`/api/v1/businesses/${biz.id}/logo`, PNG);
    const bad = await owner.put(
      `/api/v1/businesses/${biz.id}/logo`,
      Buffer.from('<svg></svg>'),
      'image/png',
    );
    expect(bad.status).toBe(415);
    expect((await owner.agent.get(`/api/v1/businesses/${biz.id}/logo`)).status).toBe(200);
  });

  it('serves the logo publicly by slug and exposes logoUrl on the public form', async () => {
    const owner = await newUser();
    const biz = await createBiz(owner);
    const anon = request(createApp());
    expect((await anon.get(`/api/v1/public/${biz.slug}/logo`)).status).toBe(404);

    await owner.put(`/api/v1/businesses/${biz.id}/logo`, PNG);
    const res = await anon.get(`/api/v1/public/${biz.slug}/logo`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');

    await Business.updateOne({ _id: biz.id }, { adminState: 'suspended' });
    expect((await anon.get(`/api/v1/public/${biz.slug}/logo`)).status).toBe(404);
  });

  it('admin listing exposes the logo version and admins can view the logo', async () => {
    const admin = await newUser();
    const owner = await newUser();
    const biz = await createBiz(owner);
    await owner.put(`/api/v1/businesses/${biz.id}/logo`, PNG);
    await User.updateOne({ _id: admin.userId }, { platformRole: 'SUPER_ADMIN' });
    const detail = await admin.agent.get(`/api/v1/admin/businesses/${biz.id}`);
    expect(detail.body.data.logoUpdatedAt).toBeTruthy();
    expect((await admin.agent.get(`/api/v1/admin/businesses/${biz.id}/logo`)).status).toBe(200);
    expect((await owner.agent.get(`/api/v1/admin/businesses/${biz.id}/logo`)).status).toBe(403);
  });
});
