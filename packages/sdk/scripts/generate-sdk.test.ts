import { execSync } from 'node:child_process';
import path from 'node:path';

import { describe, it } from 'vitest';

const PKG_ROOT = path.join(__dirname, '..');

describe('generate-sdk', () => {
  it('src/generated stays in sync with openapi.yml', () => {
    // Runs the generator in --check mode as a subprocess (the same command the
    // release workflow uses), so committed output failing to match the spec
    // fails this test with the generator's own diagnostics. This package is
    // deliberately NOT in the CI package whitelist — the test runs locally and
    // in the manual release workflow only, never gating regular PRs.
    try {
      execSync('bun scripts/generate-sdk.ts --check', {
        cwd: PKG_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      const execError = error as { stderr?: string; stdout?: string };
      throw new Error(
        `src/generated is out of date. Run \`bun generate\` in packages/sdk and commit the result.\n${execError.stderr ?? ''}${execError.stdout ?? ''}`,
        { cause: error },
      );
    }
  }, 120_000);
});
