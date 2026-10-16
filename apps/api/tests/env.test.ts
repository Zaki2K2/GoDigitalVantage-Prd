import { describe, expect, it } from 'vitest';
import { envSchema } from '../src/config/env.schema';

const required = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/gdv_test',
  CORS_ORIGIN: 'http://localhost:4200',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  JWT_REFRESH_SECRET: 'y'.repeat(32),
};

describe('public app URL configuration', () => {
  it('supports an offline LAN origin and normalizes surrounding whitespace and slashes', () => {
    const env = envSchema.parse({
      ...required,
      PUBLIC_APP_BASE_URL: ' http://192.168.1.10:4200/// ',
    });
    expect(env.PUBLIC_APP_BASE_URL).toBe('http://192.168.1.10:4200');
  });

  it('prefers the new variable while keeping legacy installations working', () => {
    const legacy = { ...required, PUBLIC_BASE_URL: 'http://localhost:4200/' };
    expect(envSchema.parse(legacy).PUBLIC_APP_BASE_URL).toBe('http://localhost:4200');
    expect(
      envSchema.parse({ ...legacy, PUBLIC_APP_BASE_URL: 'http://192.168.1.10:4200' })
        .PUBLIC_APP_BASE_URL,
    ).toBe('http://192.168.1.10:4200');
  });

  it('requires a public URL and rejects unsafe or unusable QR destinations', () => {
    expect(envSchema.safeParse(required).success).toBe(false);
    for (const url of [
      '',
      'not-a-url',
      'javascript:alert(1)',
      'ftp://192.168.1.10:4200',
      'http://owner:secret@192.168.1.10:4200',
      'http://192.168.1.10:4200?redirect=elsewhere',
      'http://192.168.1.10:4200#fragment',
      'http://192.168.1.10:4200?',
      'http://192.168.1.10:4200#',
    ]) {
      expect(envSchema.safeParse({ ...required, PUBLIC_APP_BASE_URL: url }).success, url).toBe(
        false,
      );
    }
  });
});
