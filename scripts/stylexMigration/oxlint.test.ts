// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from '@lobehub/oxlint-config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readLegacyFiles } from '.';
import { stylexMigrationOverrides } from './oxlint.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const oxlintBin = path.join(repoRoot, 'node_modules/.bin/oxlint');
const rule = 'stylex-migration(no-emotion-styles)';
const EMOTION_IMPORT =
  "import { createStyles } from '@lobehub/ui';\n\nexport const useStyles = createStyles;\n";

describe('stylex-migration/no-emotion-styles config', () => {
  let dir: string;

  const lintFiles = (files: string[]) => {
    for (const file of files) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), EMOTION_IMPORT);
    }
    const { stdout } = spawnSync(oxlintBin, ['-c', '.oxlintrc.json', '-f', 'json', ...files], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    const { diagnostics } = JSON.parse(stdout) as {
      diagnostics: { code?: string; filename: string }[];
    };
    return new Set(diagnostics.filter((d) => d.code === rule).map((d) => d.filename));
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'stylex-migration-'));
    const config = defineConfig(
      { sortImports: false, sortKeys: false },
      ...(stylexMigrationOverrides as Parameters<typeof defineConfig>[1][]),
    );
    writeFileSync(path.join(dir, '.oxlintrc.json'), JSON.stringify(config));
  });

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('exempts every legacy file, including route segments read as glob syntax', () => {
    const legacy = readLegacyFiles();
    const globLike = legacy.filter((file) => /[()[\]]/.test(file));
    expect(globLike.length).toBeGreaterThan(0);

    expect([...lintFiles(legacy)]).toEqual([]);
  }, 120_000);

  it('applies to new source files and skips tests', () => {
    const reported = lintFiles([
      'src/features/NewFeature/index.tsx',
      'src/routes/(main)/eval/bench/[id]/New.tsx',
      'src/features/NewFeature/index.test.tsx',
    ]);

    expect(reported).toEqual(
      new Set(['src/features/NewFeature/index.tsx', 'src/routes/(main)/eval/bench/[id]/New.tsx']),
    );
  }, 120_000);
});
