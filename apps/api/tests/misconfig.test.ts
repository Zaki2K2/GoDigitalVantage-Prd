import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const KEYS = ['PUBLIC_APP_BASE_URL', 'PUBLIC_BASE_URL', 'DOTENV_CONFIG_PATH'] as const;

describe('serverless startup with a missing environment variable', () => {
  // Keep a local .env file from refilling the variables these tests remove.
  process.env['DOTENV_CONFIG_PATH'] = 'does-not-exist.env';
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it('answers 500 JSON without leaking details and without exiting the process', async () => {
    delete process.env['PUBLIC_APP_BASE_URL'];
    delete process.env['PUBLIC_BASE_URL'];
    vi.resetModules();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mod = (await import('../src/vercel.js')) as unknown as {
      default: Parameters<typeof request>[0];
    };
    const handler = mod.default;
    const res = await request(handler).get('/api/v1/health');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'MISCONFIGURED',
        message: 'Server configuration is invalid',
        details: { invalidVariables: ['PUBLIC_APP_BASE_URL'] },
      },
    });
    expect(log.mock.calls.flat().join(' ')).toContain('PUBLIC_APP_BASE_URL');
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
    log.mockRestore();
  });

  it('still accepts the legacy PUBLIC_BASE_URL', async () => {
    delete process.env['PUBLIC_APP_BASE_URL'];
    process.env['PUBLIC_BASE_URL'] = 'https://web.example.com';
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.PUBLIC_APP_BASE_URL).toBe('https://web.example.com');
  });

  it('prefers PUBLIC_APP_BASE_URL and rejects invalid values', async () => {
    process.env['PUBLIC_APP_BASE_URL'] = 'https://app.example.com/';
    process.env['PUBLIC_BASE_URL'] = 'https://legacy.example.com';
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.PUBLIC_APP_BASE_URL).toBe('https://app.example.com');
    process.env['PUBLIC_APP_BASE_URL'] = 'not a url';
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(import('../src/config/env.js')).rejects.toThrow('Invalid environment');
  });
});
