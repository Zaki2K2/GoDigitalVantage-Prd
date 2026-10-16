import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { User } from '../src/modules/auth/user.model';

const PASSWORD = 'correct-horse-battery';
let seq = 0;
const newEmail = () => `user${++seq}-${Date.now()}@example.com`;

type Agent = ReturnType<typeof request.agent>;

function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const line = raw.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]?.slice(name.length + 1);
}

/** Agent that already holds a CSRF cookie and sends the matching header on every request. */
async function csrfAgent(): Promise<{ agent: Agent; csrf: string }> {
  const agent = request.agent(createApp());
  const res = await agent.get('/api/v1/auth/csrf');
  const csrf = res.body.data.csrfToken as string;
  return { agent, csrf };
}

/** Calls refresh from a fresh client that only holds the given refresh token. */
function refreshWith(rt: string) {
  return request(createApp())
    .post('/api/v1/auth/refresh')
    .set('X-CSRF-Token', 'abc')
    .set('Cookie', `gdv_rt=${rt}; gdv_csrf=abc`);
}

async function registered(email = newEmail()) {
  const { agent, csrf } = await csrfAgent();
  const res = await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({ fullName: 'Test User', email, password: PASSWORD });
  return { agent, csrf, email, res };
}

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  await Promise.all([User.init(), RefreshToken.init()]);
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('register', () => {
  it('creates a user, hashes the password and sets httpOnly cookies', async () => {
    const { res, email } = await registered();
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email, fullName: 'Test User', status: 'active' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('gdv_at='))).toMatch(/HttpOnly/);
    expect(cookies.find((c) => c.startsWith('gdv_rt='))).toMatch(
      /HttpOnly.*Path=\/api\/v1\/auth|Path=\/api\/v1\/auth.*HttpOnly/,
    );
    expect(cookies.find((c) => c.startsWith('gdv_at='))).toMatch(/SameSite=Lax/);
    expect(cookies.find((c) => c.startsWith('gdv_rt='))).toMatch(/SameSite=Lax/);
    const stored = await User.findOne({ emailLowercase: email }).lean();
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
    expect(stored?.createdAt).toBeInstanceOf(Date);
  });

  it('rejects duplicate email (case-insensitive) with 409', async () => {
    const { email } = await registered();
    const { agent, csrf } = await csrfAgent();
    const res = await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({ fullName: 'Other', email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input with the error envelope', async () => {
    const { agent, csrf } = await csrfAgent();
    const res = await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({ fullName: '', email: 'nope', password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details)).toEqual(
      expect.arrayContaining(['fullName', 'email', 'password']),
    );
  });
});

describe('login', () => {
  it('logs in with correct credentials and /me returns the user', async () => {
    const { email } = await registered();
    const { agent, csrf } = await csrfAgent();
    const login = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: email.toUpperCase(), password: PASSWORD });
    expect(login.status).toBe(200);
    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
  });

  it('returns the same generic error for wrong password and unknown email', async () => {
    const { email } = await registered();
    const { agent, csrf } = await csrfAgent();
    const wrong = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email, password: 'wrong-password-123' });
    const unknown = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: newEmail(), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['set-cookie']?.toString() ?? '').not.toContain('gdv_at');
  });

  it('rejects disabled accounts', async () => {
    const { email } = await registered();
    await User.updateOne({ emailLowercase: email }, { status: 'disabled' });
    const { agent, csrf } = await csrfAgent();
    const res = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rate-limits repeated failed logins (429) per email', async () => {
    const email = newEmail();
    const { agent, csrf } = await csrfAgent();
    const attempt = () =>
      agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', csrf)
        .send({ email, password: 'bad-password-1' });
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('unauthorized access', () => {
  it('/me without cookie → 401 envelope', async () => {
    const res = await request(createApp()).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('/me with a forged access cookie → 401', async () => {
    const res = await request(createApp()).get('/api/v1/me').set('Cookie', 'gdv_at=not.a.jwt');
    expect(res.status).toBe(401);
  });
});

describe('csrf', () => {
  it('rejects state-changing requests without the header', async () => {
    const { agent } = await csrfAgent();
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email: newEmail(), password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a mismatched header', async () => {
    const { agent } = await csrfAgent();
    const res = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'attacker-value')
      .send({ email: newEmail(), password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rejects logout and refresh without the header', async () => {
    const { agent } = await registered();
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(403);
    expect((await agent.post('/api/v1/auth/refresh')).status).toBe(403);
  });
});

describe('refresh and logout', () => {
  it('rotates the refresh token and keeps the session alive', async () => {
    const { agent, csrf, res: reg } = await registered();
    const oldRt = cookieValue(reg, 'gdv_rt');
    const res = await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    const newRt = cookieValue(res, 'gdv_rt');
    expect(newRt).toBeTruthy();
    expect(newRt).not.toBe(oldRt);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(1);
  });

  it('tolerates two simultaneous refreshes with the same cookie (multi-tab race)', async () => {
    const { res: reg } = await registered();
    const rt = cookieValue(reg, 'gdv_rt')!;
    const [a, b] = await Promise.all([refreshWith(rt), refreshWith(rt)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await RefreshToken.countDocuments({ familyRevoked: true })).toBe(0);
    // exactly one response carries a rotated refresh cookie; the loser gets an access token only
    const rotated = [cookieValue(a, 'gdv_rt'), cookieValue(b, 'gdv_rt')].filter(Boolean);
    expect(rotated).toHaveLength(1);
    expect((await refreshWith(rotated[0]!)).status).toBe(200);
  });

  it('a replay inside the grace window never yields a new refresh token', async () => {
    const { agent, csrf, res: reg } = await registered();
    const old = cookieValue(reg, 'gdv_rt')!;
    await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf);
    const replay = await refreshWith(old);
    expect(replay.status).toBe(200);
    expect(cookieValue(replay, 'gdv_at')).toBeTruthy();
    expect(cookieValue(replay, 'gdv_rt')).toBeUndefined();
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(1);
  });

  it('refresh without a cookie → 401', async () => {
    const { agent, csrf } = await csrfAgent();
    const res = await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf);
    expect(res.status).toBe(401);
  });

  it('detects refresh-token reuse and revokes the whole family', async () => {
    const { agent, csrf, res: reg } = await registered();
    const stolen = cookieValue(reg, 'gdv_rt')!;
    const rotated = await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf);
    expect(rotated.status).toBe(200);
    const legitRt = cookieValue(rotated, 'gdv_rt')!;

    // outside the concurrency grace window a replay is treated as theft
    await RefreshToken.updateMany({}, { rotatedAt: new Date(Date.now() - 60_000) });
    const replay = await refreshWith(stolen);
    expect(replay.status).toBe(401);

    // the legitimate descendant token is now dead too
    const after = await refreshWith(legitRt);
    expect(after.status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('logout revokes the session, clears cookies, and the old refresh token is unusable', async () => {
    const { agent, csrf, res: reg } = await registered();
    const rt = cookieValue(reg, 'gdv_rt')!;
    const out = await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf);
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie']?.toString()).toMatch(/gdv_at=;/);
    expect((await agent.get('/api/v1/me')).status).toBe(401);

    expect((await refreshWith(rt)).status).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const { res } = await registered();
    const rt = cookieValue(res, 'gdv_rt')!;
    const docs = await RefreshToken.find().lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.tokenHash).not.toBe(rt);
    expect(JSON.stringify(docs)).not.toContain(rt);
  });
});

describe('csrf cookie', () => {
  it('is readable by the SPA (not HttpOnly) and SameSite=Lax', async () => {
    const res = await request(createApp()).get('/api/v1/auth/csrf');
    const line = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(line).toMatch(/^gdv_csrf=/);
    expect(line).not.toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Lax/);
  });
});
