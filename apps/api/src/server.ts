import { connectDb } from './db';
import { env } from './config/env';
import { createApp } from './app';

async function main() {
  await connectDb();
  createApp().listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
}

main().catch((err) => {
  console.error('Startup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
