import { Schema, model } from 'mongoose';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

interface HitDoc {
  key: string;
  count: number;
  /** End of the current window; the TTL index removes the document shortly after. */
  resetAt: Date;
}

const hitSchema = new Schema<HitDoc>(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true },
    resetAt: { type: Date, required: true },
  },
  { collection: 'rate_limits' },
);
hitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });
const Hit = model<HitDoc>('RateLimitHit', hitSchema);

const isDup = (e: unknown) => (e as { code?: number }).code === 11000;

/**
 * Shared rate-limit counters in MongoDB, so every serverless instance enforces one limit.
 * Each hit is one atomic upsert with an aggregation-pipeline update: expired windows restart at 1.
 * Used when `RATE_LIMIT_STORE=mongo`; local development keeps the in-memory store.
 */
export class MongoRateLimitStore implements Store {
  readonly localKeys = false;
  private windowMs = 60_000;

  constructor(private readonly name: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private k(key: string) {
    return `${this.name}:${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const doc = await Hit.findOne({ key: this.k(key), resetAt: { $gt: new Date() } }).lean();
    return doc ? { totalHits: doc.count, resetTime: doc.resetAt } : undefined;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const next = new Date(now.getTime() + this.windowMs);
    const run = () =>
      Hit.findOneAndUpdate(
        { key: this.k(key) },
        [
          {
            $set: {
              count: {
                $cond: [
                  { $gt: [{ $ifNull: ['$resetAt', new Date(0)] }, now] },
                  { $add: ['$count', 1] },
                  1,
                ],
              },
              resetAt: {
                $cond: [{ $gt: [{ $ifNull: ['$resetAt', new Date(0)] }, now] }, '$resetAt', next],
              },
            },
          },
        ],
        { upsert: true, returnDocument: 'after', updatePipeline: true },
      ).lean();
    let doc;
    try {
      doc = await run();
    } catch (e) {
      if (!isDup(e)) throw e;
      doc = await run(); // two first hits raced to create the key: the loser now updates it
    }
    return { totalHits: doc!.count, resetTime: doc!.resetAt };
  }

  async decrement(key: string): Promise<void> {
    await Hit.updateOne({ key: this.k(key), count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await Hit.deleteOne({ key: this.k(key) });
  }
}

export { Hit as RateLimitHit };
