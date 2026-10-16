import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { User } from '../src/modules/auth/user.model';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';

const PASSWORD = 'correct-horse-battery';
let seq = 0;

interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  get: (url: string) => request.Test;
}

async function newUser(): Promise<Client> {
  const agent = request.agent(createApp());
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  const res = await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({
      fullName: 'Owner',
      email: `biz${++seq}-${Date.now()}@example.com`,
      password: PASSWORD,
    });
  return {
    agent,
    csrf,
    userId: res.body.data.user.id,
    post: (url, body = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    patch: (url, body = {}) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    get: (url) => agent.get(url),
  };
}

const profile = (over: object = {}) => ({
  createRequestId: randomUUID(),
  name: "Joe's Coffee & Tea",
  category: 'Cafe',
  email: 'Hello@Joes.example',
  phone: '+1 (555) 123-4567',
  address: '1 Main St, Springfield',
  timezone: 'America/New_York',
  googleReviewUrl: 'https://g.page/r/abc/review',
  ...over,
});

async function publishDefault(c: Client, id: string) {
  const q = (await c.get(`/api/v1/businesses/${id}/questionnaire`)).body.data.questionnaire;
  return c.post(`/api/v1/businesses/${id}/questionnaire/publish`, {
    expectedRevision: q.draftRevision,
  });
}

async function createBiz(c: Client, over: object = {}) {
  const res = await c.post('/api/v1/businesses', profile(over));
  return res;
}

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  await Promise.all([User.init(), RefreshToken.init(), Business.init(), BusinessMembership.init()]);
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    Business.deleteMany({}),
    BusinessMembership.deleteMany({}),
  ]);
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('business creation', () => {
  it('creates a business with an owner membership, slug and onboarding state', async () => {
    const c = await newUser();
    const res = await createBiz(c);
    expect(res.status).toBe(201);
    const b = res.body.data.business;
    expect(b).toMatchObject({
      name: "Joe's Coffee & Tea",
      email: 'hello@joes.example',
      slug: 'joe-s-coffee-tea',
      status: 'onboarding',
      role: 'owner',
      timezone: 'America/New_York',
      logoRef: null,
      onboarding: { currentStep: 'questionnaire', completedSteps: ['business'], completedAt: null },
    });
    const membership = await BusinessMembership.findOne({ businessId: b.id }).lean();
    expect(membership?.userId.toString()).toBe(c.userId);
    expect(membership?.role).toBe('owner');
  });

  it('requires authentication and CSRF', async () => {
    const anon = await request(createApp()).get('/api/v1/businesses');
    expect(anon.status).toBe(401);
    const c = await newUser();
    const noCsrf = await c.agent.post('/api/v1/businesses').send(profile());
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_INVALID');
  });

  it('validates input with Zod (and rejects unknown fields like slug/status)', async () => {
    const c = await newUser();
    const bad = await createBiz(c, {
      name: '',
      timezone: 'Mars/Base',
      email: 'nope',
      phone: 'abc',
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.details)).toEqual(
      expect.arrayContaining(['name', 'timezone', 'email', 'phone']),
    );
    expect((await createBiz(c, { googleReviewUrl: 'http://insecure.example' })).status).toBe(422);
    expect((await createBiz(c, { slug: 'hijack' })).status).toBe(422);
    expect((await createBiz(c, { status: 'active' })).status).toBe(422);
    expect((await c.post('/api/v1/businesses', { name: 'x' })).status).toBe(422);
    expect(await Business.countDocuments()).toBe(0);
  });

  it('treats a repeated submission (same createRequestId) as one business', async () => {
    const c = await newUser();
    const body = profile();
    const first = await c.post('/api/v1/businesses', body);
    const second = await c.post('/api/v1/businesses', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.business.id).toBe(first.body.data.business.id);
    expect(await Business.countDocuments()).toBe(1);
    expect(await BusinessMembership.countDocuments()).toBe(1);
  });

  it('handles concurrent identical submissions without duplicates', async () => {
    const c = await newUser();
    const body = profile();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => c.post('/api/v1/businesses', body)),
    );
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.business.id)).size).toBe(1);
    expect(await Business.countDocuments()).toBe(1);
    expect(await BusinessMembership.countDocuments()).toBe(1);
  });

  it('gives unique slugs to businesses with the same name', async () => {
    const a = await newUser();
    const b = await newUser();
    const s1 = (await createBiz(a)).body.data.business.slug;
    const s2 = (await createBiz(b)).body.data.business.slug;
    expect(s1).not.toBe(s2);
    expect(s2).toMatch(/^joe-s-coffee-tea-[0-9a-f]{6}$/);
  });
});

describe('membership and tenant isolation', () => {
  it('lists only the caller’s businesses', async () => {
    const a = await newUser();
    const b = await newUser();
    await createBiz(a, { name: 'Alpha' });
    await createBiz(b, { name: 'Bravo' });
    const list = await a.get('/api/v1/businesses');
    expect(list.body.data.businesses.map((x: { name: string }) => x.name)).toEqual(['Alpha']);
  });

  it('denies another user access to read, edit and change onboarding (403)', async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const id = (await createBiz(owner)).body.data.business.id;

    expect((await intruder.get(`/api/v1/businesses/${id}`)).status).toBe(403);
    expect((await intruder.patch(`/api/v1/businesses/${id}`, { name: 'Pwned' })).status).toBe(403);
    expect((await intruder.get(`/api/v1/businesses/${id}/onboarding`)).status).toBe(403);
    const ob = await intruder.patch(`/api/v1/businesses/${id}/onboarding`, {
      currentStep: 'confirm',
    });
    expect(ob.status).toBe(403);
    expect((await Business.findById(id).lean())?.name).toBe("Joe's Coffee & Tea");
  });

  it('denies unauthenticated and malformed-id access', async () => {
    const owner = await newUser();
    const id = (await createBiz(owner)).body.data.business.id;
    expect((await request(createApp()).get(`/api/v1/businesses/${id}`)).status).toBe(401);
    expect((await owner.get('/api/v1/businesses/not-an-id')).status).toBe(403);
    expect((await owner.get(`/api/v1/businesses/${'a'.repeat(24)}`)).status).toBe(403);
  });

  it('lets a member read but not modify; the owner can modify', async () => {
    const owner = await newUser();
    const member = await newUser();
    const id = (await createBiz(owner)).body.data.business.id;
    await BusinessMembership.create({ businessId: id, userId: member.userId, role: 'member' });

    const read = await member.get(`/api/v1/businesses/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.data.business.role).toBe('member');
    expect((await member.patch(`/api/v1/businesses/${id}`, { name: 'Nope' })).status).toBe(403);
    expect(
      (await member.patch(`/api/v1/businesses/${id}/onboarding`, { currentStep: 'confirm' }))
        .status,
    ).toBe(403);
    expect((await owner.patch(`/api/v1/businesses/${id}`, { name: 'Renamed' })).status).toBe(200);
  });
});

describe('profile update', () => {
  it('updates fields, clears optionals with null/empty, and keeps the slug immutable', async () => {
    const c = await newUser();
    const created = (await createBiz(c)).body.data.business;
    const res = await c.patch(`/api/v1/businesses/${created.id}`, {
      name: 'New Name',
      phone: '',
      address: null,
      timezone: 'Europe/London',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.business).toMatchObject({
      name: 'New Name',
      phone: null,
      address: null,
      timezone: 'Europe/London',
      slug: created.slug,
    });
    expect((await c.patch(`/api/v1/businesses/${created.id}`, { slug: 'x' })).status).toBe(422);
    expect((await c.patch(`/api/v1/businesses/${created.id}`, { name: '' })).status).toBe(422);
    const fetched = await c.get(`/api/v1/businesses/${created.id}`);
    expect(fetched.body.data.business.name).toBe('New Name');
  });
});

describe('onboarding progress', () => {
  it('persists the current step and confirmation across sessions', async () => {
    const c = await newUser();
    const id = (await createBiz(c)).body.data.business.id;
    const url = `/api/v1/businesses/${id}/onboarding`;
    expect((await publishDefault(c, id)).status).toBe(200);

    expect((await c.patch(url, { currentStep: 'confirm' })).status).toBe(200);
    const done = await c.patch(url, { completeStep: 'confirm' });
    expect(done.body.data.onboarding.completedSteps).toEqual([
      'business',
      'questionnaire',
      'confirm',
    ]);
    expect((await c.patch(url, { currentStep: 'qr' })).status).toBe(200);

    // a brand-new session for the same user sees the saved progress
    const again = request.agent(createApp());
    const csrf = (await again.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const user = await User.findById(c.userId).lean();
    await again
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: user?.emailLowercase, password: PASSWORD });
    const restored = await again.get(url);
    expect(restored.body.data.onboarding).toEqual({
      currentStep: 'qr',
      completedSteps: ['business', 'questionnaire', 'confirm'],
      completedAt: null,
    });
  });

  it('never marks onboarding complete and rejects steps that cannot be finished yet', async () => {
    const c = await newUser();
    const id = (await createBiz(c)).body.data.business.id;
    const url = `/api/v1/businesses/${id}/onboarding`;
    await publishDefault(c, id);
    await c.patch(url, { currentStep: 'confirm' });
    await c.patch(url, { currentStep: 'qr' });
    await c.patch(url, { completeStep: 'confirm' });

    expect((await c.patch(url, { completeStep: 'qr' })).status).toBe(422);
    expect((await c.patch(url, { completeStep: 'questionnaire' })).status).toBe(422);
    expect((await c.patch(url, { completedAt: new Date().toISOString() })).status).toBe(422);
    const b = await Business.findById(id).lean();
    expect(b?.onboarding?.completedAt).toBeNull();
    expect(b?.status).toBe('onboarding');
  });

  it('enforces step order but allows going back', async () => {
    const c = await newUser();
    const id = (await createBiz(c)).body.data.business.id;
    const url = `/api/v1/businesses/${id}/onboarding`;

    const skip = await c.patch(url, { currentStep: 'qr' });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('STEP_NOT_AVAILABLE');
    expect((await c.patch(url, { completeStep: 'confirm' })).status).toBe(409);
    expect((await c.patch(url, { currentStep: 'business' })).status).toBe(200);
    expect((await c.patch(url, {})).status).toBe(422);
  });
});
