/** Explicit operator bootstrap; never reachable over HTTP or normal registration. */
import { connectDb } from '../../db';
import mongoose from 'mongoose';
import { User } from '../auth/user.model';
import { audit } from './admin.service';

async function main() {
  const [email, confirmation] = process.argv.slice(2);
  if (!email || confirmation !== '--confirm-super-admin')
    throw new Error('Usage: npm run admin:grant -- email@example.com --confirm-super-admin');
  await connectDb();
  const user = await User.findOne({
    emailLowercase: email.trim().toLowerCase(),
    status: 'active',
  }).lean();
  if (!user) throw new Error('Active registered user not found');
  const log = await audit(
    String(user._id),
    'users',
    String(user._id),
    'SUPER_ADMIN_GRANTED_BY_OPERATOR',
    { platformRole: user.platformRole ?? 'USER' },
    { platformRole: 'SUPER_ADMIN' },
  );
  await User.updateOne({ _id: user._id }, { platformRole: 'SUPER_ADMIN' });
  await log.updateOne({ outcome: 'completed' });
  console.log('Super Admin granted. Sign in again to refresh navigation.');
}
main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : 'Grant failed');
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
