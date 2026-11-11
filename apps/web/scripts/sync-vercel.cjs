// Writes API_PRODUCTION_URL from .env into the /api rewrite of vercel.json.
// vercel.json is static and cannot read env vars, so run this (npm run sync:vercel)
// after changing API_PRODUCTION_URL, then commit vercel.json.
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv } = require('./load-env.cjs');

const raw = (loadEnv().API_PRODUCTION_URL || '').trim();
if (!raw) {
  console.log('API_PRODUCTION_URL not set (env or .env): keeping vercel.json as is.');
  process.exit(0);
}
const url = raw.replace(/\/+$/, '');
if (!/^https?:\/\//.test(url)) {
  console.error(`API_PRODUCTION_URL must be an http(s) URL, got: ${raw}`);
  process.exit(1);
}

const file = path.join(__dirname, '..', 'vercel.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const rewrite = config.rewrites.find((r) => r.source === '/api/:path*');
if (!rewrite) {
  console.error('No /api/:path* rewrite found in vercel.json');
  process.exit(1);
}
rewrite.destination = `${url}/api/:path*`;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`vercel.json /api rewrite -> ${rewrite.destination}`);
