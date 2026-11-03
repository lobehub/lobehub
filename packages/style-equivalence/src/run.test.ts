import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runComparison } from './run';

const fixtures = path.resolve(import.meta.dirname, '../test/fixtures');
const rootModules = path.resolve(import.meta.dirname, '../../../node_modules');
let repo: string;
let records: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'style-eq-e2e-'));
  records = await mkdtemp(path.join(tmpdir(), 'style-eq-records-'));
  await cp(path.join(fixtures, 'mini-repo'), repo, { recursive: true });
  await symlink(rootModules, path.join(repo, 'node_modules'));
  await writeFile(path.join(repo, '.gitignore'), 'node_modules\n');
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '.');
  git('commit', '-qm', 'base');
  await writeFile(
    path.join(repo, 'src/Card.module.css'),
    '.card { padding: 10px; }\n.active { color: rgb(0, 0, 255); border-color: var(--ink-alias); }\n.title { font-weight: 600; color: var(--ink); }\n',
  );
  git('commit', '-qam', 'head');
}, 30_000);

afterAll(async () => {
  await rm(repo, { force: true, recursive: true });
  await rm(records, { force: true, recursive: true });
});

describe('runComparison', () => {
  it('reports the padding change on the card and stores the evidence', async () => {
    const result = await runComparison({
      base: 'HEAD~1',
      configFile: path.join(fixtures, 'mini-project/style-equivalence.config.ts'),
      head: 'HEAD',
      recordsDir: records,
      repo,
    });
    expect(result.files).toEqual(['src/Card.tsx']);
    const statuses = Object.fromEntries(
      result.cases.map((entry) => [entry.key, entry.result.status]),
    );
    expect(statuses).toEqual({
      'src/Card.tsx|Card#0': 'difference',
      'src/Card.tsx|Card#1': 'equal',
    });
    const card = result.cases.find((entry) => entry.key === 'src/Card.tsx|Card#0')!;
    expect(card.plan.combos).toEqual([{ active: false }, { active: true }]);
    expect(
      card.result.rootCauses.map((cause) => [cause.property, cause.before, cause.after]),
    ).toEqual(expect.arrayContaining([['padding-block-start', '8px', '10px']]));
    const stored = JSON.parse(await readFile(path.join(result.runDir, 'results.json'), 'utf8'));
    expect(stored.cases).toHaveLength(2);
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
    expect(result.mutation).toMatchObject({ caught: 1, evaluated: 1, passed: true });
    expect(result.verdict).toMatchObject({ mergeable: false, reasons: ['difference 1'] });
    const [mutant] = result.mutation.mutants;
    expect(mutant).toMatchObject({
      caseKey: 'src/Card.tsx|Card#1',
      operator: 'numeric',
      outcome: 'caught',
    });
    expect(mutant.expected).toHaveLength(32);
    expect(mutant.detected).toEqual(mutant.expected);
  }, 180_000);

  it('drops a token swap that resolves to the same value as an equivalent mutant', async () => {
    const result = await runComparison({
      base: 'HEAD~1',
      configFile: path.join(fixtures, 'mini-project/style-equivalence.config.ts'),
      head: 'HEAD',
      mutationOperators: ['swap-token'],
      recordsDir: records,
      repo,
    });
    expect(result.mutation).toMatchObject({ equivalent: 1, evaluated: 0, passed: true });
    expect(result.mutation.mutants[0]).toMatchObject({
      expected: [],
      operator: 'swap-token',
      outcome: 'equivalent',
    });
  }, 180_000);
});
