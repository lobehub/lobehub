// @vitest-environment node
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { readLegacyFiles } from '.';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const rule = 'stylex-migration/no-emotion-styles';

const ruleFor = async (eslint: ESLint, file: string) => {
  const config: { rules?: Record<string, unknown> } | undefined =
    await eslint.calculateConfigForFile(path.join(repoRoot, file));
  // undefined for files ESLint ignores globally
  return config?.rules?.[rule];
};

describe('stylex-migration/no-emotion-styles config', () => {
  const eslint = new ESLint({ cwd: repoRoot });

  it('exempts every legacy file, including route segments read as glob syntax', async () => {
    const legacy = readLegacyFiles();
    const globLike = legacy.filter((file) => /[()[\]]/.test(file));
    expect(globLike.length).toBeGreaterThan(0);

    const enforced: string[] = [];
    for (const file of legacy) if (await ruleFor(eslint, file)) enforced.push(file);
    expect(enforced).toEqual([]);
  }, 120_000);

  it('applies to new source files and skips tests', async () => {
    expect(await ruleFor(eslint, 'src/features/NewFeature/index.tsx')).toBeDefined();
    expect(await ruleFor(eslint, 'src/routes/(main)/eval/bench/[id]/New.tsx')).toBeDefined();
    expect(await ruleFor(eslint, 'src/features/NewFeature/index.test.tsx')).toBeUndefined();
  }, 120_000);
});
