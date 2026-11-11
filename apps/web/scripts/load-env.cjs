// Minimal .env loader (no dependency). Real process.env values win over the file.
const fs = require('node:fs');
const path = require('node:path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  const values = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !line.trim().startsWith('#')) {
        values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  }
  return { ...values, ...process.env };
}

module.exports = { loadEnv };
