import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost:27017/gdv_test',
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
