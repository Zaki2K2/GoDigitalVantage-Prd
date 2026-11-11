import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { envSchema } from '../src/config/env.schema';

// Read-only audit: print variable names/status only, never values, hashes, URIs or validation input.
const paths = process.argv.slice(2);
const files = paths.length ? paths : ['.env', '.env.production'];
const sensitive =
  /^(?:JWT_.*_SECRET|.*TOKEN_SECRET|.*API_KEY|.*ACCESS_TOKEN|.*APP_SECRET|.*VERIFY_TOKEN|.*WEBHOOK_SECRET|CRON_SECRET|MARKETING_UNSUBSCRIBE_SECRET)$/;
const configurations: { file: string; values: Record<string, string> }[] = [];
let invalid = false;
for (const file of files) {
  const target = resolve(file);
  if (!existsSync(target)) {
    console.log(`${file}: absent`);
    continue;
  }
  const values = parse(readFileSync(target));
  configurations.push({ file, values });
  const result = envSchema.safeParse(values);
  console.log(`${file}: ${result.success ? 'valid' : 'INVALID'}`);
  if (!result.success) {
    invalid = true;
    console.log(
      `  invalid variables: ${[...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ')}`,
    );
  }
  console.log(
    `  configured secret names: ${Object.keys(values)
      .filter((k) => sensitive.test(k) && values[k])
      .join(', ')}`,
  );
}
for (let a = 0; a < configurations.length; a++) {
  for (let b = a + 1; b < configurations.length; b++) {
    const first = configurations[a]!,
      second = configurations[b]!;
    const reused = Object.keys(first.values).filter(
      (k) => sensitive.test(k) && first.values[k] && first.values[k] === second.values[k],
    );
    if (reused.length) {
      invalid = true;
      console.log(`REUSED between ${first.file} and ${second.file}: ${reused.join(', ')}`);
    }
  }
}
if (invalid) process.exitCode = 1;
