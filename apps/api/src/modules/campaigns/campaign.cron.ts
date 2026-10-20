import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { runCampaignBatch } from './campaign.execution';
import { CampaignSchedulerState } from './campaign.model';
import { AppError } from '../../shared/errors';
export function createCampaignCronRouter() {
  const router = Router();
  router.get('/api/v1/internal/campaigns/run', async (req, res) => {
    const secret = process.env['CRON_SECRET'];
    const expected = Buffer.from(`Bearer ${secret ?? ''}`),
      actual = Buffer.from(req.get('authorization') ?? '');
    if (
      !secret ||
      secret.length < 32 ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res
        .status(401)
        .json({ error: { code: 'UNAUTHORIZED', message: 'Scheduler authentication required' } });
      return;
    }
    res.set('Cache-Control', 'no-store');
    await CampaignSchedulerState.updateOne(
      { _id: 'scheduler' },
      { $set: { startedAt: new Date() } },
      { upsert: true },
    );
    try {
      const data = await runCampaignBatch();
      await CampaignSchedulerState.updateOne(
        { _id: 'scheduler' },
        { $set: { completedAt: new Date(), lastError: null, processed: data.processed } },
      );
      res.json({ data });
    } catch (error) {
      await CampaignSchedulerState.updateOne(
        { _id: 'scheduler' },
        {
          $set: { lastError: error instanceof AppError ? error.code : 'CAMPAIGN_EXECUTION_FAILED' },
        },
      );
      throw error;
    }
  });
  return router;
}
