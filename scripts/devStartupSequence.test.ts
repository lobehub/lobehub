/**
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('devStartupSequence', () => {
  /**
   * Cloud starts this script with bare `node` (native type stripping), which does not map a
   * `.mjs` specifier to its `.mts` source the way `tsx` and Vitest do. Load it in a real Node
   * process so a relative import that only those tools can resolve fails here instead of breaking
   * Cloud `bun run dev` with ERR_MODULE_NOT_FOUND.
   */
  it('resolves every import under bare node', () => {
    const entry = pathToFileURL(path.resolve(__dirname, 'devStartupSequence.mts')).href;
    const result = spawnSync(
      'node',
      ['--input-type=module', '-e', `await import(${JSON.stringify(entry)});`],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.status).toBe(0);
  });
});
