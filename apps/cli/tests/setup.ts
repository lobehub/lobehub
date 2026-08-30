import { vi } from 'vitest';

import type * as loggerModule from '../src/utils/logger';

// The real logger writes straight to stdout/stderr, so every suite stubbed it by
// hand. Suites asserting on log calls import `log` and read the spies below; a
// suite needing different behavior overrides this with its own `vi.mock`.
vi.mock('../src/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof loggerModule>();

  return {
    ...actual,
    log: Object.fromEntries(Object.keys(actual.log).map((key) => [key, vi.fn()])),
    setVerbose: vi.fn(),
  };
});
