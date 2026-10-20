import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ connection: { readyState: 0 }, connect: vi.fn() }));
vi.mock('mongoose', () => ({ default: mock }));
vi.mock('../src/config/env', () => ({
  env: { NODE_ENV: 'production', MONGODB_URI: 'mongodb://unit.invalid/test' },
}));
import { connectDb } from '../src/db';

beforeEach(() => {
  mock.connect.mockReset();
  mock.connection.readyState = 0;
  delete (globalThis as { __gdvMongo?: unknown }).__gdvMongo;
});

describe('serverless Mongo connection cache', () => {
  it('shares concurrent connection attempts and reuses an established pool', async () => {
    let resolve!: (value: typeof mock) => void;
    mock.connect.mockImplementation(
      () =>
        new Promise<typeof mock>((r) => {
          resolve = r;
        }),
    );
    const first = connectDb(),
      second = connectDb();
    expect(first).toBe(second);
    expect(mock.connect).toHaveBeenCalledOnce();
    mock.connection.readyState = 1;
    resolve(mock);
    await first;
    await expect(connectDb()).resolves.toBe(mock);
    expect(mock.connect).toHaveBeenCalledOnce();
    expect(mock.connect.mock.calls[0]?.[1]).toMatchObject({
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      waitQueueTimeoutMS: 8000,
      bufferCommands: false,
      autoIndex: false,
      autoCreate: false,
    });
  });
  it('does not return a stale resolved promise after disconnection', async () => {
    mock.connect.mockResolvedValue(mock);
    await connectDb(); // A connection was established and subsequently disconnected.
    mock.connection.readyState = 0;
    await connectDb();
    expect(mock.connect).toHaveBeenCalledTimes(2);
  });
  it('allows a fresh attempt after failure without caching the rejection', async () => {
    mock.connect.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(mock);
    await expect(connectDb()).rejects.toThrow('offline');
    await expect(connectDb()).resolves.toBe(mock);
    expect(mock.connect).toHaveBeenCalledTimes(2);
  });
});
