import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app';
import { connectDb } from './db';

let app: Express | undefined;

/**
 * The Vercel runtime decorates req/res with its own lazy `body`/`query`/`cookies` and
 * `status`/`send`/`json`/`redirect` helpers. Remove any own copies so Express's implementations
 * (and body-parser reading the raw stream) behave exactly as in local development.
 */
function useExpressSemantics(req: IncomingMessage, res: ServerResponse): void {
  for (const [target, keys] of [
    [req, ['body', 'query', 'cookies']],
    [res, ['status', 'send', 'json', 'redirect']],
  ] as const) {
    for (const key of keys) {
      if (Object.getOwnPropertyDescriptor(target, key)?.configurable) {
        delete (target as unknown as Record<string, unknown>)[key];
      }
    }
  }
}

/**
 * Vercel Function entry (see `api/index.js` and `vercel.json`). The Express app is built once per
 * warm instance; the Mongo connection is reused across invocations. Local dev still uses
 * `server.ts`.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await connectDb();
  } catch (err) {
    console.error('Database unavailable:', err instanceof Error ? err.message : err);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: { code: 'DB_UNAVAILABLE', message: 'Service temporarily unavailable' },
      }),
    );
    return;
  }
  useExpressSemantics(req, res);
  app ??= createApp();
  (app as unknown as (r: IncomingMessage, s: ServerResponse) => void)(req, res);
}
