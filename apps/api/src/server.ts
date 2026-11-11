import { connectDb } from './db';
import { env } from './config/env';
import { createApp } from './app';

async function main() {
  await connectDb();
  createApp().listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
}

main().catch(() => {
  console.error('Startup failed; verify environment configuration and database connectivity');
  process.exit(1);
});
