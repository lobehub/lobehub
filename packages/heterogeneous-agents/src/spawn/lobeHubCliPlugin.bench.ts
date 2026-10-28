import { describe, test } from 'vitest';

import { claudeCodeLoadsPluginSkills } from './lobeHubCliPlugin';

// Run separately from concurrent unit tests, from this package:
// bunx vitest bench --run --maxWorkers=1 --no-file-parallelism src/spawn/lobeHubCliPlugin.bench.ts
for (const length of [10_000, 100_000]) {
  describe(`Claude Code version parsing (${length} digits)`, () => {
    const digits = '9'.repeat(length);

    for (const [name, version] of [
      ['major without separators', digits],
      ['missing patch', `${digits}.0`],
      ['long minor', `2.${digits}`],
      ['digits before a valid version', `${digits}x 2.0.20`],
    ]) {
      test(name, async ({ bench }) => {
        await bench('parse version', () => {
          claudeCodeLoadsPluginSkills(version);
        }).run();
      });
    }
  });
}
