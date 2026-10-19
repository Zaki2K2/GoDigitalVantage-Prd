import type { RequestHandler } from 'express';
import { User } from '../auth/user.model';
import { forbidden } from '../../shared/errors';

/** Always read current privileges from the database; never trust role claims or request input. */
export const requireSuperAdmin: RequestHandler = async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const user = await User.findById(req.auth!.userId, { platformRole: 1, status: 1 }).lean();
    if (user?.status !== 'active' || user.platformRole !== 'SUPER_ADMIN')
      throw forbidden('Super Admin access required');
    next();
  } catch (err) {
    next(err);
  }
};
