import { defineConfig } from 'vitest/config';

const testUri = process.env['GDV_TEST_MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/gdv_test';
const database = new URL(testUri);
if (
  database.protocol !== 'mongodb:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
  database.pathname !== '/gdv_test' ||
  database.username ||
  database.password ||
  database.search ||
  database.hash
)
  throw new Error('GDV_TEST_MONGODB_URI must select a credential-free loopback /gdv_test database');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    // Real MongoDB and HTTP integration tests need room for cold starts on CI/Windows.
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ['tests/network-safety.ts'],
    env: {
      DOTENV_CONFIG_PATH: 'does-not-exist.test.env',
      NODE_ENV: 'test',
      MONGODB_URI: testUri,
      EMAIL_ENABLED: 'false',
      EMAIL_TEST_MODE: 'false',
      RESEND_API_KEY: '',
      RESEND_DEV_API_KEY: '',
      RESEND_WEBHOOK_SECRET: '',
      RESEND_DEV_WEBHOOK_SECRET: '',
      INSTANT_REWARDS_TOKEN_SECRET: 'isolated-test-reward-signing-key-2026',
      MARKETING_UNSUBSCRIBE_SECRET: 'isolated-test-marketing-signing-key-2026',
      CRON_SECRET: '',
      WHATSAPP_ENABLED: 'false',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_APP_SECRET: '',
      WHATSAPP_VERIFY_TOKEN: '',
      WHATSAPP_PHONE_NUMBER_ID: '',
      WHATSAPP_GRAPH_BASE_URL: 'http://127.0.0.1:3198',
      CORS_ORIGIN: 'http://localhost:4200',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
      PUBLIC_BASE_URL: 'http://localhost:4200',
      PUBLIC_APP_BASE_URL: 'http://localhost:4200',
      LOGIN_RATE_LIMIT_MAX: '5',
      REGISTER_RATE_LIMIT_MAX: '1000',
      PUBLIC_SUBMIT_RATE_LIMIT_MAX: '25',
      PUBLIC_SCAN_RATE_LIMIT_MAX: '25',
    },
  },
});
