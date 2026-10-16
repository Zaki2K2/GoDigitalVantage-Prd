import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

describe('LAN origin allowlist', () => {
  it('allows the explicit LAN origin and preserves credentialed CSRF preflight headers', async () => {
    const previous = env.CORS_ORIGIN;
    env.CORS_ORIGIN = 'http://localhost:4200, http://192.168.1.10:4200';
    try {
      const app = createApp();
      const allowed = await request(app)
        .options('/api/v1/auth/login')
        .set('Origin', 'http://192.168.1.10:4200')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
      expect(allowed.status).toBe(204);
      expect(allowed.headers['access-control-allow-origin']).toBe('http://192.168.1.10:4200');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      expect(allowed.headers['access-control-allow-headers']).toContain('x-csrf-token');

      const disallowed = await request(app)
        .options('/api/v1/auth/login')
        .set('Origin', 'http://untrusted.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      env.CORS_ORIGIN = previous;
    }
  });
});
