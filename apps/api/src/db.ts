import mongoose from 'mongoose';
import { env } from './config/env';
import { recordDbCommand } from './shared/perf';

const globals = globalThis as { __gdvMongo?: Promise<typeof mongoose> };
const diagnostics = process.env['PERFORMANCE_LOGGING'] === 'true';
const observed = new WeakSet<object>();

/** Adds command round-trip time (durations only; never command bodies) to the active request. */
function observeCommands(m: typeof mongoose): void {
  const client = m.connection.getClient();
  if (observed.has(client)) return;
  observed.add(client);
  client.on('commandSucceeded', (e) => recordDbCommand(e.duration));
  client.on('commandFailed', (e) => recordDbCommand(e.duration));
}

/**
 * Connects once per process and reuses the connection: on Vercel a warm function instance keeps
 * serving requests over the same pool, a cold start opens one. Cache only in-flight connects:
 * a resolved promise must not mask a disconnected connection on a later invocation.
 */
export function connectDb(options: { autoIndex?: boolean } = {}): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  globals.__gdvMongo ??= mongoose
    .connect(env.MONGODB_URI, {
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      waitQueueTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      serverSelectionTimeoutMS: 8000,
      bufferCommands: false,
      monitorCommands: diagnostics,
      autoIndex: options.autoIndex ?? env.NODE_ENV !== 'production',
      autoCreate: env.NODE_ENV !== 'production',
    })
    .then((m) => {
      if (diagnostics) observeCommands(m);
      return m;
    })
    .finally(() => {
      globals.__gdvMongo = undefined;
    });
  return globals.__gdvMongo;
}
