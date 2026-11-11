const { loadEnv } = require('./scripts/load-env.cjs');

const env = loadEnv();

module.exports = {
  '/api': {
    target: env.API_PROXY_TARGET || 'http://127.0.0.1:3100',
    secure: false,
  },
};
