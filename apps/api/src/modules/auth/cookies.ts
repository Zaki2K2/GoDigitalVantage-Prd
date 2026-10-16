import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env';
import { newOpaqueToken, ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS } from './tokens';

export const ACCESS_COOKIE = 'gdv_at';
export const REFRESH_COOKIE = 'gdv_rt';
export const CSRF_COOKIE = 'gdv_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

const base: CookieOptions = { secure: env.NODE_ENV === 'production', sameSite: 'lax' };

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string | null,
): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base,
    httpOnly: true,
    path: '/',
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  if (refreshToken === null) return;
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base, httpOnly: true, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true, path: REFRESH_COOKIE_PATH });
}

/** Double-submit CSRF cookie: readable by the SPA, which echoes it in a header. */
export function setCsrfCookie(res: Response): string {
  const token = newOpaqueToken();
  res.cookie(CSRF_COOKIE, token, {
    ...base,
    httpOnly: false,
    path: '/',
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });
  return token;
}
