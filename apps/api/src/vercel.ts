import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { perfStore, type PerfContext } from './shared/perf.js';

let app: Express | undefined;
let firstInvocation = true;

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
  const started = performance.now();
  const coldStart = firstInvocation;
  firstInvocation = false;
  let startupMs = 0;
  let connectMs = 0;
  let applicationStarted: number | undefined = undefined;
  const perf: PerfContext = { authMs: 0, dbMs: 0, dbOps: 0 };
  // Explicit opt-in; never log URLs, query strings, identifiers, cookies, bodies or DB errors.
  const diagnostics = process.env['PERFORMANCE_LOGGING'] === 'true';
  if (diagnostics)
    res.once('finish', () => {
      const matched = (req as IncomingMessage & { route?: { path?: unknown } }).route?.path;
      // baseUrl holds resolved values for mounted params: keep only plain words, redact the rest.
      const base = ((req as IncomingMessage & { baseUrl?: unknown }).baseUrl as string | undefined)
        ?.split('/')
        .map((part) => (/^(?:[a-z-]*|v\d{1,2})$/.test(part) ? part : ':id'))
        .join('/');
      const route =
        typeof matched === 'string' ? `${base ?? ''}${matched === '/' ? '' : matched}` : undefined;
      console.info(
        JSON.stringify({
          event: 'api_performance',
          method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'].includes(
            req.method ?? '',
          )
            ? req.method
            : 'OTHER',
          route: route || 'unmatched',
          status: res.statusCode,
          region: process.env['VERCEL_REGION'] ?? 'local',
          coldStart,
          startupMs: Math.round(startupMs),
          connectMs: Math.round(connectMs),
          authMs: Math.round(perf.authMs),
          dbMs: Math.round(perf.dbMs),
          dbOps: perf.dbOps,
          // mongoose readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
          dbState: mongoose.connection.readyState,
          applicationMs:
            applicationStarted === undefined
              ? 0
              : Math.round(performance.now() - applicationStarted),
          totalMs: Math.round(performance.now() - started),
        }),
      );
    });
  // Loaded lazily so a missing/invalid environment variable becomes a readable 500 (variable names
  // go to the function logs) instead of a crash while the module initialises.
  let createApp: typeof import('./app.js').createApp;
  let connectDb: typeof import('./db.js').connectDb;
  try {
    [{ createApp }, { connectDb }] = await Promise.all([import('./app.js'), import('./db.js')]);
    startupMs = performance.now() - started;
  } catch (err) {
    startupMs = performance.now() - started;
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
  const connectionStarted = performance.now();
  try {
    await connectDb();
    connectMs = performance.now() - connectionStarted;
  } catch (err) {
    connectMs = performance.now() - connectionStarted;
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
  if (diagnostics)
    res.setHeader(
      'Server-Timing',
      `startup;dur=${startupMs.toFixed(1)}, mongo_connect;dur=${connectMs.toFixed(1)}`,
    );
  applicationStarted = performance.now();
  useExpressSemantics(req, res);
  app ??= createApp();
  const serve = app as unknown as (r: IncomingMessage, s: ServerResponse) => void;
  if (diagnostics) perfStore.run(perf, () => serve(req, res));
  else serve(req, res);
}
