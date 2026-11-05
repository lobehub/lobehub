import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGitBranch } from '../info';
import { addGitWorktree, listGitWorktrees } from '../worktrees';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const initRepo = async (parent: string, name = 'lobehub'): Promise<string> => {
  const dir = path.join(parent, name);
  await mkdir(dir, { recursive: true });
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  return dir;
};

/**
 * The `~/.lobehub/worktrees/<repoKey>/<branchFolder>` shape `deriveWorktreePath`
 * (`@lobechat/types`, which owns the repo-key hash) hands the device.
 */
const deriveWorktreePath = (sourcePath: string, branch: string, hash = '0000beef'): string =>
  `${home}/.lobehub/worktrees/${path.basename(sourcePath)}-${hash}/${branch.replaceAll('/', '-') || 'worktree'}`;

let home: string;
let code: string;
let repo: string;

beforeEach(async () => {
  // A disposable stand-in for the home directory the server passes in.
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'lfs-home-')));
  code = await realpath(await mkdtemp(path.join(tmpdir(), 'lfs-code-')));
  repo = await initRepo(code);
});

afterEach(async () => {
  await Promise.all([home, code].map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('addGitWorktree', () => {
  it('creates the worktree and its missing parent folders under ~/.lobehub/worktrees', async () => {
    const worktreePath = deriveWorktreePath(repo, 'feat/x');
    const result = await addGitWorktree({ branch: 'feat/x', path: repo, worktreePath });

    expect(result.success).toBe(true);
    expect(
      result.worktreePath?.startsWith(path.join(home, '.lobehub', 'worktrees') + path.sep),
    ).toBe(true);
    expect(path.basename(result.worktreePath!)).toBe('feat-x');
    expect(await getGitBranch(result.worktreePath!)).toEqual({ branch: 'feat/x' });
    expect((await listGitWorktrees(repo)).map((w) => w.path)).toContain(result.worktreePath);
  });

  it('keeps same-named repos in separate folders', async () => {
    const other = await initRepo(path.join(code, 'other'));
    const a = await addGitWorktree({
      branch: 'feat/x',
      path: repo,
      worktreePath: deriveWorktreePath(repo, 'feat/x'),
    });
    const b = await addGitWorktree({
      branch: 'feat/x',
      path: other,
      worktreePath: deriveWorktreePath(other, 'feat/x', '1111cafe'),
    });

    expect(a.success && b.success).toBe(true);
    expect(a.worktreePath).not.toBe(b.worktreePath);
  });

  it('still lists an existing sibling worktree next to new central ones', async () => {
    const sibling = path.join(code, 'lobehub-legacy');
    git(repo, 'worktree', 'add', '-b', 'legacy', sibling);

    const result = await addGitWorktree({
      branch: 'feat/y',
      path: repo,
      worktreePath: deriveWorktreePath(repo, 'feat/y'),
    });

    expect(result.success).toBe(true);
    expect(existsSync(sibling)).toBe(true);
    const paths = (await listGitWorktrees(repo)).map((w) => w.path);
    expect(paths).toEqual(expect.arrayContaining([repo, sibling, result.worktreePath]));
  });

  it('reports an existing target folder instead of reusing it', async () => {
    const worktreePath = deriveWorktreePath(repo, 'feat/x');
    await mkdir(worktreePath, { recursive: true });

    const result = await addGitWorktree({ branch: 'feat/x', path: repo, worktreePath });

    expect(result).toEqual({
      error: `Worktree folder already exists: ${worktreePath}`,
      success: false,
    });
    expect(git(repo, 'branch', '--list', 'feat/x')).toBe('');
  });

  it('reports an unwritable worktree root', async () => {
    // A file where the `.lobehub` folder should be makes the mkdir fail even
    // when the tests run as root (where permission bits are ignored).
    await writeFile(path.join(home, '.lobehub'), '');
    const worktreePath = deriveWorktreePath(repo, 'feat/x');

    const result = await addGitWorktree({ branch: 'feat/x', path: repo, worktreePath });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Cannot create worktree folder .*\.lobehub.*: E[A-Z]+$/);
    expect(git(repo, 'branch', '--list', 'feat/x')).toBe('');
  });

  it('rejects an empty branch and a relative target', async () => {
    expect(
      await addGitWorktree({ branch: ' ', path: repo, worktreePath: deriveWorktreePath(repo, '') }),
    ).toEqual({ error: 'Branch name is required', success: false });
    expect(await addGitWorktree({ branch: 'feat/x', path: repo, worktreePath: 'rel/x' })).toEqual({
      error: 'Worktree path must be absolute: rel/x',
      success: false,
    });
  });
});
