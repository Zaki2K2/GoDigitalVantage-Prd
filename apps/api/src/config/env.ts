import 'dotenv/config';
import { envSchema } from './env.schema';

/** Thrown at import when the environment is invalid. `fields` holds variable NAMES only. */
export class EnvError extends Error {
  constructor(readonly fields: string[]) {
    super(`Invalid environment: ${fields.join(', ')}`);
    this.name = 'EnvError';
  }
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  console.error('Invalid environment:', errors);
  // Throw instead of process.exit: a local start still fails loudly (uncaught error, exit 1), and the
  // serverless handler can answer with a clear 500 instead of crashing the whole function process.
  throw new EnvError(Object.keys(errors));
}

export const env = parsed.data;
