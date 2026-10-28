import { InstantRewardsService } from './modules/instant-rewards/instant-reward.service';
import { createCampaignRouter } from './modules/campaigns/campaign.routes';
import { createCampaignCronRouter } from './modules/campaigns/campaign.cron';
import { createMarketingPublicRouter } from './modules/campaigns/campaign.marketing';
import {
  createInstantRewardRouter,
  createInstantRewardWebhook,
} from './modules/instant-rewards/instant-reward.routes';
import { createImageRouter, createPublicImageRouter } from './modules/images/image.routes';
import { createAdminRouter } from './modules/admin/admin.routes';
import { createSupportOwnerRouter } from './modules/admin/support.routes';
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

export function createApp(rewards = new InstantRewardsService()) {
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
  app.use(createInstantRewardWebhook(rewards));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/v1/health', healthRouter);
  app.use(createCampaignCronRouter());
  app.use(createMarketingPublicRouter());
  app.use('/api/v1', createPublicRouter(), createPublicImageRouter());
  app.use(
    '/api/v1',
    csrfProtection,
    createAuthRouter(),
    createInstantRewardRouter(rewards),
    createImageRouter(),
    // Campaign routes own their guards; handle them before the broad /admin middleware.
    createCampaignRouter(),
    createAdminRouter(),
    createSupportOwnerRouter(),
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
