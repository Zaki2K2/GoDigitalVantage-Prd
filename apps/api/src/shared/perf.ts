import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request timing totals. Numbers only: no commands, filters, identifiers or error text. */
export interface PerfContext {
  authMs: number;
  dbMs: number;
  dbOps: number;
}

export const perfStore = new AsyncLocalStorage<PerfContext>();

/** Adds the duration of an authorization lookup to the current request (no-op when disabled). */
export async function timeAuth<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = perfStore.getStore();
  if (!ctx) return fn();
  const started = performance.now();
  try {
    return await fn();
  } finally {
    ctx.authMs += performance.now() - started;
  }
}

/** Records one finished MongoDB command's server round-trip against the current request. */
export function recordDbCommand(durationMs: number): void {
  const ctx = perfStore.getStore();
  if (!ctx) return;
  ctx.dbMs += durationMs;
  ctx.dbOps += 1;
}
