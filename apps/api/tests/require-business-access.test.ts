import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/error-handler';
import { requireBusinessAccess } from '../src/middleware/require-business-access';

const BID = 'a'.repeat(24);

function appWith(lookup: Parameters<typeof requireBusinessAccess>[0], authed = true) {
  const app = express();
  app.use((req, _res, next) => {
    if (authed) req.auth = { userId: 'u1' };
    next();
  });
  app.get('/businesses/:businessId/ping', requireBusinessAccess(lookup), (req, res) => {
    res.json({ data: req.tenant });
  });
  app.use(errorHandler);
  return app;
}

describe('requireBusinessAccess', () => {
  it('allows members and exposes the tenant context', async () => {
    const res = await request(appWith(async () => ({ role: 'owner' }))).get(
      `/businesses/${BID}/ping`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ businessId: BID, role: 'owner' });
  });

  it('denies non-members with 403', async () => {
    const res = await request(appWith(async () => null)).get(`/businesses/${BID}/ping`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('denies malformed ids without calling the lookup', async () => {
    let called = false;
    const res = await request(appWith(async () => ((called = true), { role: 'owner' }))).get(
      '/businesses/not-an-id/ping',
    );
    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });

  it('requires authentication', async () => {
    const res = await request(appWith(async () => ({ role: 'owner' }), false)).get(
      `/businesses/${BID}/ping`,
    );
    expect(res.status).toBe(401);
  });
});
