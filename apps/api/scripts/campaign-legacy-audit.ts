/** Read-only report of platform campaigns that need business-owner review. Writes nothing. */
import mongoose from 'mongoose';
import { connectDb } from '../src/db';
import { reviewPlatformCampaigns } from '../src/modules/campaigns/campaign.legacy-audit';
async function main() {
  const [database] = process.argv.slice(2);
  if (!database) throw new Error('Usage: npm run campaigns:audit-legacy -- DATABASE');
  mongoose.set('autoIndex', false);
  await connectDb({ autoIndex: false });
  if (mongoose.connection.name !== database)
    throw new Error('Connected database does not match the explicit target');
  const rows = await reviewPlatformCampaigns();
  console.log(JSON.stringify({ database, total: rows.length, campaigns: rows }, null, 2));
  console.log(`${rows.filter((r) => r.needsOwnerReview).length} campaign(s) need owner review.`);
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Audit failed');
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
