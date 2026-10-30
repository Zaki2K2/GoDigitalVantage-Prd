import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export function signAccessToken(userId: string, sessionVersion = 0, sessionId?: string): string {
  return jwt.sign(
    { sessionIssuedAt: Date.now(), sessionVersion, ...(sessionId ? { sid: sessionId } : {}) },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: ACCESS_TTL_SECONDS,
    },
  );
}

/** Refresh-token family id of the login this access token belongs to (undefined for legacy tokens). */
export function accessSessionId(token: string): string | undefined {
  const payload = jwt.decode(token);
  if (!payload || typeof payload === 'string') return undefined;
  return typeof payload['sid'] === 'string' && payload['sid'].length <= 64
    ? payload['sid']
    : undefined;
}

/** Returns the user id, or null if the token is missing/invalid/expired. */
export function verifyAccessToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Refresh tokens are opaque random values; only an HMAC of them is stored. */
export function newOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

/** Millisecond session boundary; legacy JWTs fall back to their issued-at second. */
export function accessIssuedAt(token: string): number {
  const payload = jwt.decode(token);
  if (!payload || typeof payload === 'string') return 0;
  return typeof payload['sessionIssuedAt'] === 'number'
    ? payload['sessionIssuedAt']
    : (payload.iat ?? 0) * 1000;
}

/** Missing versions identify pre-version sessions; their timestamp cutoff still applies. */
export function accessSessionVersion(token: string): number | null {
  const payload = jwt.decode(token);
  if (!payload || typeof payload === 'string') return null;
  return Number.isSafeInteger(payload['sessionVersion']) && payload['sessionVersion'] >= 0
    ? payload['sessionVersion']
    : null;
}
