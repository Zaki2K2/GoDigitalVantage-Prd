import { Router } from 'express';
import { createLoginLimiter, createRegisterLimiter } from '../../middleware/rate-limit';
import { requireAuth } from '../../middleware/require-auth';
import * as service from './auth.service';
import { loginSchema, registerSchema } from './auth.schemas';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies, setCsrfCookie } from './cookies';
import { toUserDto } from './user.model';

function refreshCookie(cookies: unknown): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

export function createAuthRouter() {
  const router = Router();
  const loginLimiter = createLoginLimiter();
  const registerLimiter = createRegisterLimiter();

  router.get('/auth/csrf', (_req, res) => {
    res.json({ data: { csrfToken: setCsrfCookie(res) } });
  });

  router.post('/auth/register', registerLimiter, async (req, res) => {
    const session = await service.register(registerSchema.parse(req.body));
    setAuthCookies(res, session.accessToken, session.refreshToken);
    res.status(201).json({ data: { user: toUserDto(session.user) } });
  });

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const session = await service.login(loginSchema.parse(req.body));
    setAuthCookies(res, session.accessToken, session.refreshToken);
    res.json({ data: { user: toUserDto(session.user) } });
  });

  router.post('/auth/refresh', async (req, res) => {
    try {
      const session = await service.refresh(refreshCookie(req.cookies));
      setAuthCookies(res, session.accessToken, session.refreshToken);
      res.json({ data: { user: toUserDto(session.user) } });
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  });

  router.post('/auth/logout', async (req, res) => {
    await service.logout(refreshCookie(req.cookies));
    clearAuthCookies(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    const user = await service.getActiveUser(req.auth!.userId);
    res.json({ data: { user: toUserDto(user) } });
  });

  return router;
}
