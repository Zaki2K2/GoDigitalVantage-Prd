import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';

let app: Express | undefined;

/**
 *
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
  // Loaded lazily so a missing/invalid environment variable becomes a readable 500 (variable names
  // go to the function logs) instead of a crash while the module initialises.
  let createApp: typeof import('./app.js').createApp;
  let connectDb: typeof import('./db.js').connectDb;
  try {
    ({ createApp } = await import('./app.js'));
    ({ connectDb } = await import('./db.js'));
  } catch (err) {
    console.error('Startup error:', err instanceof Error ? `${err.name}: ${err.message}` : err);
    // Names of invalid variables are safe to show (never values); other failures stay generic.
    const fields = (err as { name?: string; fields?: unknown }).fields;
    const isEnv = err instanceof Error && err.name === 'EnvError' && Array.isArray(fields);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: isEnv
          ? {
              code: 'MISCONFIGURED',
              message: 'Server configuration is invalid',
              details: { invalidVariables: fields },
            }
          : { code: 'STARTUP_FAILED', message: 'Server failed to start' },
      }),
    );
    return;
  }
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
