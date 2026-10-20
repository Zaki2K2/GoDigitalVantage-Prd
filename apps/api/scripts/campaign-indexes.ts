/** Explicit operator migration: safe replacement index is built before the legacy index is removed. */
import mongoose from 'mongoose';
import { connectDb } from '../src/db';
import {
  migrateCampaignIndexes,
  campaignIndexesReady,
} from '../src/modules/campaigns/campaign.migration';
async function main() {
  const [database, confirm] = process.argv.slice(2);
  if (!database || confirm !== '--confirm-index-migration')
    throw new Error('Usage: npm run campaigns:indexes -- DATABASE --confirm-index-migration');
  mongoose.set('autoIndex', false);
  await connectDb({ autoIndex: false });
  if (mongoose.connection.name !== database)
    throw new Error('Connected database does not match the explicit target');
  await migrateCampaignIndexes();
  if (!(await campaignIndexesReady()))
    throw new Error('Required campaign uniqueness indexes failed verification');
  console.log('Campaign indexes ready. Existing response uniqueness remains enforced.');
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Index migration failed');
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
