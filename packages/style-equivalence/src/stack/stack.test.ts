import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mergeStack, planShards } from './index';

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();

const commitOn = async (branch: string, files: Record<string, string>) => {
  git('checkout', '-q', '-b', branch, 'main');
  for (const [file, content] of Object.entries(files))
    await writeFile(path.join(repo, file), content);
  git('commit', '-qam', branch);
  return git('rev-parse', 'HEAD');
};

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'style-eq-stack-'));
  git('init', '-q', '-b', 'main');
  await writeFile(path.join(repo, 'a.txt'), 'a\n');
  await writeFile(path.join(repo, 'b.txt'), 'b\n');
  await writeFile(path.join(repo, 'A.tsx'), 'export const A = 1;\n');
  await writeFile(path.join(repo, 'legacy.json'), '["one"]\n');
  git('add', '.');
  git('commit', '-qm', 'base');
});

afterAll(() => rm(repo, { force: true, recursive: true }));

describe('mergeStack', () => {
  it('merges every head and reports the one whose comparable sources conflict', async () => {
    const heads = [
      {
        id: '1',
        sha: await commitOn('pr-a', { 'A.tsx': 'export const A = 2;\n', 'legacy.json': '["a"]\n' }),
      },
      {
        id: '2',
        sha: await commitOn('pr-b', { 'b.txt': 'b from pr-b\n', 'legacy.json': '["b"]\n' }),
      },
      { id: '3', sha: await commitOn('pr-c', { 'A.tsx': 'export const A = 3;\n' }) },
    ];
    git('checkout', '-q', 'main');
    const result = await mergeStack({ base: 'main', heads, repo });
    expect(result.merged).toEqual(['1', '2']);
    expect(result.conflicts).toEqual([{ files: ['A.tsx'], id: '3' }]);
    expect(result.resolved).toEqual([{ files: ['legacy.json'], id: '2' }]);
    expect(git('show', `${result.head}:A.tsx`)).toBe('export const A = 2;');
    expect(git('show', `${result.head}:b.txt`)).toBe('b from pr-b');
    expect(git('show', `${result.head}:legacy.json`)).toBe('["a"]');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
    expect(git('status', '--porcelain')).toBe('');
  });
});

describe('planShards', () => {
  it('gives each file to the first PR that touches it and drops empty shards', () => {
    expect(
      planShards([
        { files: ['src/A.tsx', 'src/B.tsx'], id: '1' },
        { files: ['src/B.tsx'], id: '2' },
        { files: ['src/C.tsx'], id: '3' },
      ]),
    ).toEqual([
      { files: ['src/A.tsx', 'src/B.tsx'], id: '1' },
      { files: ['src/C.tsx'], id: '3' },
    ]);
  });
});
