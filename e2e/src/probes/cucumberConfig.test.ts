import { glob } from 'node:fs/promises';

import { loadConfiguration } from '@cucumber/cucumber/api';
import { describe, expect, it } from 'vitest';

describe('Cucumber support discovery', () => {
  it('loads runtime support and steps without importing Vitest test files', async () => {
    const { runConfiguration } = await loadConfiguration({ file: 'cucumber.config.js' });
    const paths = await Array.fromAsync(glob(runConfiguration.support.requirePaths ?? []));

    expect(paths.some((path) => path.endsWith('/support/seedTestUser.ts'))).toBe(true);
    expect(paths.some((path) => path.endsWith('/steps/hooks.ts'))).toBe(true);
    expect(paths.filter((path) => path.endsWith('.test.ts'))).toEqual([]);
  });
});
