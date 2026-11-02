import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const readSourceFiles = async (relativeDir: string): Promise<string[]> => {
  const directory = path.join(repoRoot, relativeDir);
  const files = await readdir(directory, { recursive: true });

  return Promise.all(
    files
      .filter(
        (file) =>
          /\.(?:ts|tsx)$/.test(file) &&
          // Dedicated third-mode tests intentionally exercise the on-demand module.
          !file.endsWith('.onDemand.test.ts'),
      )
      .map((file) => readFile(path.join(directory, file), 'utf8')),
  );
};

describe('legacy chat/agent isolation', () => {
  it('does not import the on-demand module from existing chat/agent paths', async () => {
    const sources = (
      await Promise.all([
        readSourceFiles('apps/server/src/modules/Mecha/ContextEngineering'),
        readSourceFiles('src/services/chat/mecha'),
      ])
    ).flat();

    for (const source of sources) {
      expect(source).not.toMatch(
        /(?:from\s+|import\s*\(\s*)['"][^'"]*(?:onDemand|on-demand)[^'"]*['"]/,
      );
    }
  });

  it('does not expose the on-demand module from the context-engine root index', async () => {
    const rootIndex = await readFile(
      path.join(repoRoot, 'packages/context-engine/src/index.ts'),
      'utf8',
    );

    expect(rootIndex).not.toContain('./onDemand');
  });
});
