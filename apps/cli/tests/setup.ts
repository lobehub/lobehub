import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, vi } from 'vitest';

import type * as loggerModule from '../src/utils/logger';

// Point the CLI home at a throwaway directory for the whole run. Anything the
// CLI persists — settings, credentials, the connect daemon's state, execution
// traces — resolves against `resolveCliDirName()` under `os.homedir()`, so
// without this a suite that drives a command end to end writes into the
// developer's real `~/.lobehub`.
const testHomeDirName = `.lobehub-test-${process.pid}`;
process.env.LOBEHUB_CLI_HOME = testHomeDirName;

afterAll(() => {
  fs.rmSync(path.join(os.homedir(), testHomeDirName), { force: true, recursive: true });
});

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
