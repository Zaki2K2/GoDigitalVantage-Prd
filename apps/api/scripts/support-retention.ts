/** Reports (and with --apply, purges only never-activated) support grants. Never touches the access log. */
import mongoose from 'mongoose';
import { connectDb } from '../src/db';
import {
  planSupportRetention,
  purgeNeverActivatedGrants,
  RETENTION,
} from '../src/modules/admin/support-retention';
async function main() {
  const [database, flag] = process.argv.slice(2);
  if (!database) throw new Error('Usage: npm run support:retention -- DATABASE [--apply]');
  await connectDb();
  if (mongoose.connection.name !== database)
    throw new Error('Connected database does not match the explicit target');
  console.log(JSON.stringify({ policy: RETENTION, plan: await planSupportRetention() }, null, 2));
  if (flag === '--apply')
    console.log(`Removed ${await purgeNeverActivatedGrants()} never-activated grant(s).`);
  else console.log('Dry run. Re-run with --apply to remove only never-activated grants.');
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Retention report failed');
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
