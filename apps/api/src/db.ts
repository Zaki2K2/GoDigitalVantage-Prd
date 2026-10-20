import mongoose from 'mongoose';
import { env } from './config/env';

const globals = globalThis as { __gdvMongo?: Promise<typeof mongoose> };

/**
 * Connects once per process and reuses the connection: on Vercel a warm function instance keeps
 * serving requests over the same pool, a cold start opens one. A failed attempt is not cached.
 */
export function connectDb(options: { autoIndex?: boolean } = {}): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  globals.__gdvMongo ??= mongoose
    .connect(env.MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
      bufferCommands: false,
      autoIndex: options.autoIndex ?? env.NODE_ENV !== 'production',
    })
    .catch((err: unknown) => {
      globals.__gdvMongo = undefined;
      throw err;
    });
  return globals.__gdvMongo;
}
