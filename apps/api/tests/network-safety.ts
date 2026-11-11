import { beforeEach, vi } from 'vitest';

// Provider contract tests replace this with explicit mocks. Unmocked fetch never leaves the suite.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External network is disabled in automated tests; inject a provider mock');
    }),
  );
});
