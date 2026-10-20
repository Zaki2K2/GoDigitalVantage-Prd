import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectDb } from '../src/db';
import { MongoRateLimitStore, RateLimitHit } from '../src/middleware/mongo-rate-limit-store';
import handler from '../src/vercel';

beforeAll(async () => {
  await connectDb();
  await RateLimitHit.init();
});
beforeEach(async () => {
  await RateLimitHit.deleteMany({});
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const store = (name: string, windowMs = 60_000) => {
  const s = new MongoRateLimitStore(name);
  s.init({ windowMs } as Parameters<MongoRateLimitStore['init']>[0]);
  return s;
};

describe('connectDb', () => {
  it('reuses one connection across calls', async () => {
    const a = await connectDb();
    const b = await connectDb();
    expect(a).toBe(b);
    expect(mongoose.connection.readyState).toBe(1);
  });
});

describe('MongoRateLimitStore', () => {
  it('counts every concurrent hit exactly once (no lost updates, no duplicate keys)', async () => {
    const s = store('t');
    const res = await Promise.all(Array.from({ length: 25 }, () => s.increment('ip1')));
    expect(res.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(await RateLimitHit.countDocuments({ key: 't:ip1' })).toBe(1);
  });

  it('starts a new window after expiry, decrements, resets and isolates names', async () => {
    const s = store('w', 80);
    expect((await s.increment('k')).totalHits).toBe(1);
    expect((await s.increment('k')).totalHits).toBe(2);
    await s.decrement('k');
    expect((await s.get('k'))?.totalHits).toBe(1);
    await new Promise((r) => setTimeout(r, 120));
    expect(await s.get('k')).toBeUndefined();
    expect((await s.increment('k')).totalHits).toBe(1);
    await s.resetKey('k');
    expect(await s.get('k')).toBeUndefined();
    const other = store('other');
    await other.increment('k');
    expect((await store('w').increment('k')).totalHits).toBe(1);
  });

  it('enforces one limit across separate app instances (simulated cold/warm functions)', async () => {
    const make = () => {
      const a = express();
      a.use(rateLimit({ windowMs: 60_000, limit: 3, store: store('shared'), validate: false }));
      a.get('/x', (_req, res) => void res.json({ ok: true }));
      return a;
    };
    const [a, b] = [make(), make()];
    const codes: number[] = [];
    for (const app of [a, b, a, b, a]) codes.push((await request(app).get('/x')).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
});

describe('Vercel handler', () => {
  it('serves the existing Express routes and JSON errors from a function-style handler', async () => {
    const health = await request(handler).get('/api/v1/health');
    expect(health.status).toBe(200);
    const missing = await request(handler).get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('emits opt-in route-template timings without logging secrets or request input', async () => {
    const previous = process.env['PERFORMANCE_LOGGING'];
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      process.env['PERFORMANCE_LOGGING'] = 'true';
      const response = await request(handler).get('/api/v1/health?token=DO_NOT_LOG');
      expect(response.status).toBe(200);
      expect(response.headers['server-timing']).toMatch(
        /startup;dur=\d+\.\d, mongo_connect;dur=\d+\.\d/,
      );
      const metrics = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(metrics).toMatchObject({
        event: 'api_performance',
        route: '/api/v1/health',
        status: 200,
        dbState: 1,
      });
      for (const key of ['authMs', 'dbMs', 'dbOps']) expect(metrics[key]).toBeGreaterThanOrEqual(0);
      expect(typeof metrics.coldStart).toBe('boolean');
      expect(metrics.totalMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(log.mock.calls)).not.toContain('DO_NOT_LOG');
    } finally {
      if (previous === undefined) delete process.env['PERFORMANCE_LOGGING'];
      else process.env['PERFORMANCE_LOGGING'] = previous;
      log.mockRestore();
    }
  });

  it('keeps auth cookies and CSRF working through the handler', async () => {
    const agent = request.agent(handler);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
    const noToken = await agent.post('/api/v1/auth/register').send({
      fullName: 'A',
      email: `v${Date.now()}@example.com`,
      password: 'correct-horse-battery',
    });
    expect(noToken.status).toBe(403);
    const ok = await agent
      .post('/api/v1/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({
        fullName: 'A',
        email: `v${Date.now()}@example.com`,
        password: 'correct-horse-battery',
      });
    expect(ok.status).toBe(201);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
  });
});
