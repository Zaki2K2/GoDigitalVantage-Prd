import type { RequestHandler } from 'express';
import { User } from '../auth/user.model';
import { forbidden } from '../../shared/errors';
export const requireInstantRewardAdmin: RequestHandler = async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const user = await User.findById(req.auth!.userId, {
      platformRole: 1,
      status: 1,
      permissions: 1,
    }).lean();
    if (
      user?.status !== 'active' ||
      (user.platformRole !== 'SUPER_ADMIN' && !user.permissions?.includes('instant_rewards:manage'))
    )
      throw forbidden('Instant Rewards management permission required');
    next();
  } catch (error) {
    next(error);
  }
};
