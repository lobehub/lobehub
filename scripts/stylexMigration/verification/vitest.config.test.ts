import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const localConfig = 'scripts/stylexMigration/verification/vitest.config.ts';
const localTest = (file: string) => file.startsWith('scripts/stylexMigration/verification/');

const listTests = async (config: string, project?: string) => {
  const { stdout } = await execute(
    process.execPath,
    [
      vitest,
      'list',
      '--config',
      config,
      '--filesOnly',
      ...(project ? ['--project', project] : []),
      'scripts/stylexMigration',
      'src/styles/sx.test.ts',
      '--json',
    ],
    {
      cwd: root,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
      maxBuffer: 4 * 1024 ** 2,
      timeout: 30_000,
    },
  );
  const files: { file: string }[] = JSON.parse(stdout);
  return files.map(({ file }) => path.relative(root, file).split(path.sep).join('/'));
};

describe('local StyleX verification test discovery', () => {
  it('has unambiguous module names on case-insensitive filesystems', async () => {
    const files = await readdir(fileURLToPath(new URL('./', import.meta.url)), {
      recursive: true,
    });
    const modules = files
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .map((file) => file.replace(/\.[cm]?[jt]sx?$/, '').toLowerCase());
    expect(new Set(modules).size).toBe(modules.length);
  });

  it('keeps verification out of app CI without hiding existing migration or sx tests', async () => {
    const files = await listTests('vitest.config.mts', 'app');
    expect(files.filter(localTest)).toEqual([]);
    expect(files).toContain('scripts/stylexMigration/baseline.test.ts');
    expect(files).toContain('src/styles/sx.test.ts');
  });

  it('does not collect local tooling in server CI', async () => {
    expect(await listTests('vitest.config.mts', 'server')).toEqual([]);
  });

  it('keeps the CLI, local helpers and type contract available through the opt-in config', async () => {
    const files = await listTests(localConfig);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every(localTest)).toBe(true);
    expect(files).toEqual(
      expect.arrayContaining([
        'scripts/stylexMigration/verification/__tests__/cliIntegration.test.ts',
        'scripts/stylexMigration/verification/gate/gate.test.ts',
        'scripts/stylexMigration/verification/vitest.config.test.ts',
        'scripts/stylexMigration/verification/browser/snapshot.test.ts',
        'scripts/stylexMigration/verification/__tests__/sxArguments.test.ts',
      ]),
    );
    expect(files).not.toContain('scripts/stylexMigration/baseline.test.ts');
    expect(files).not.toContain('src/styles/sx.test.ts');
  });
});
