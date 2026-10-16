import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { csrfProtection } from './middleware/csrf';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createBusinessRouter } from './modules/businesses/business.routes';
import { createPublicRouter } from './modules/public/public.routes';
import { createRewardRouter } from './modules/rewards/reward.routes';
import { createCrmRouter } from './modules/responses/response.routes';
import { createQrRouter } from './modules/qr/qr.routes';
import { createQuestionnaireRouter } from './modules/questionnaires/questionnaire.routes';
import { healthRouter } from './modules/health/health.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(
    cors({
      // Origins never carry a trailing slash, so tolerate one (and blanks) in the setting.
      origin: env.CORS_ORIGIN.split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1', createPublicRouter());
  app.use(
    '/api/v1',
    csrfProtection,
    createAuthRouter(),
    createBusinessRouter(),
    createQuestionnaireRouter(),
    createQrRouter(),
    createCrmRouter(),
    createRewardRouter(),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
