import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runSourceCorpus } from './sourceCorpus/run';

const rootModules = path.resolve(import.meta.dirname, '../../../../node_modules');
const configFile = path.resolve(
  import.meta.dirname,
  '../../test/fixtures/stylex-project/style-equivalence.config.ts',
);
let repo: string;
let records: string;

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'style-eq-source-corpus-'));
  records = await mkdtemp(path.join(tmpdir(), 'style-eq-source-records-'));
  await writeFile(path.join(repo, 'package.json'), '{"name":"corpus","private":true}\n');
  await writeFile(path.join(repo, '.gitignore'), 'node_modules\n');
  await symlink(rootModules, path.join(repo, 'node_modules'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'files');
}, 30_000);

afterAll(async () => {
  await rm(repo, { force: true, recursive: true });
  await rm(records, { force: true, recursive: true });
});

describe('source corpus', () => {
  it('reports each pair with its expected outcome', async () => {
    const results = await runSourceCorpus({ configFile, recordsDir: records, repo });
    const actual = Object.fromEntries(results.map((entry) => [entry.id, entry.actual]));
    expect(actual).toMatchObject({
      'background-split': 'equivalent',
      'cross-component': 'flagged',
      'font-inherit': 'changed',
    });
    expect(
      results
        .filter((entry) => !entry.passed)
        .map((entry) => `${entry.id}: expected ${entry.expected}, got ${entry.actual}`),
    ).toEqual([]);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe(
      '',
    );
  }, 300_000);
});
