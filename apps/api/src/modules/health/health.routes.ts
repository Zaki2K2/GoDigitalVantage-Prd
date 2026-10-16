import { Router } from 'express';
import mongoose from 'mongoose';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const db = mongoose.connection.readyState === 1 ? 'up' : 'down';
  res
    .status(db === 'up' ? 200 : 503)
    .json({ data: { status: db === 'up' ? 'ok' : 'degraded', db } });
});
