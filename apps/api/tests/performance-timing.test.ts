import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['PERFORMANCE_LOGGING'] = 'true';
});

import mongoose from 'mongoose';
import request from 'supertest';
import { connectDb } from '../src/db';
import handler from '../src/vercel';

beforeAll(async () => {
  await connectDb();
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('request timing diagnostics', () => {
  it('attributes authorization and database time to the request without leaking input', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const agent = request.agent(handler);
      const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
      const email = `timing${Date.now()}@example.com`;
      await agent
        .post('/api/v1/auth/register')
        .set('X-CSRF-Token', csrf)
        .send({ fullName: 'Timing Person', email, password: 'correct-horse-battery' })
        .expect(201);
      log.mockClear();
      await agent.get('/api/v1/me?secret=DO_NOT_LOG').expect(200);
      const metrics = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(metrics.authMs).toBeGreaterThan(0);
      expect(metrics.dbOps).toBeGreaterThan(0);
      expect(metrics.dbMs).toBeGreaterThan(0);
      expect(metrics.route).toBe('/api/v1/me');
      const serialized = JSON.stringify(log.mock.calls);
      for (const secret of ['DO_NOT_LOG', email, 'Timing Person', 'correct-horse'])
        expect(serialized).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });
});
