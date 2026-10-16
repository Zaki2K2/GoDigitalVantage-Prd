import mongoose from 'mongoose';
import { env } from './config/env';
import { createApp } from './app';

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  createApp().listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
}

main().catch((err) => {
  console.error('Startup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
