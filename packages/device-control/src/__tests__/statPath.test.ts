import { homedir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { statPath } from '../workspace';

describe('statPath', () => {
  it('expands a leading ~ before checking the filesystem', async () => {
    const result = await statPath({ path: '~' });

    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
    expect(result.path).toBe(homedir());
  });

  it('expands ~/… and reports a missing path after expansion', async () => {
    const result = await statPath({ path: '~/__lobehub_missing_working_dir__' });

    expect(result.exists).toBe(false);
    expect(result.isDirectory).toBe(false);
    expect(result.path).toBe(path.join(homedir(), '__lobehub_missing_working_dir__'));
  });

  it('leaves a literal absolute path untouched', async () => {
    const result = await statPath({ path: homedir() });

    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
    expect(result.path).toBe(homedir());
  });
});
