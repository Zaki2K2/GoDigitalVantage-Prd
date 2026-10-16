import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('app foundation', () => {
  it('health reports degraded (503) when db not connected', async () => {
    const res = await request(createApp()).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.data.db).toBe('down');
  });

  it('unknown route returns error envelope', async () => {
    const res = await request(createApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
