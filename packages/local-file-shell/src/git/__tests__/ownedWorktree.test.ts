import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupOwnedWorktree,
  countUncommittedFiles,
  restoreOwnedWorktree,
} from '../ownedWorktree';
import { OWNER_MARKER_FILE, readOwnerMarker, writeOwnerMarker } from '../ownerMarker';
import { addGitWorktree } from '../worktrees';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const cleanup: string[] = [];
const tempDir = async (prefix: string) => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
};

const initRepo = async (dir: string) => {
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(dir, 'a.txt'), 'hello\n');
  await writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
};

let repo: string;
let root: string;
let worktree: string;
const BRANCH = 'lobehub/quiet-hill';
/** The creation receipt the app wrote when it made the worktree. */
const TOKEN = 'owner-token-0123456789abcdef';

const addWorktree = (target: string, branch = BRANCH) =>
  git(repo, 'worktree', 'add', '-b', branch, target);

beforeEach(async () => {
  repo = await tempDir('owt-repo-');
  await initRepo(repo);
  root = path.join(await tempDir('owt-home-'), '.lobehub', 'worktrees');
  worktree = path.join(root, 'repo-1a2b3c4d', 'quiet-hill');
  await mkdir(path.dirname(worktree), { recursive: true });
  addWorktree(worktree);
  await writeOwnerMarker(worktree, TOKEN);
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const run = (
  params: { discard?: boolean; ownerToken?: string | null; worktreePath?: string } = {},
) =>
  cleanupOwnedWorktree({
    discard: params.discard,
    ownerToken: params.ownerToken === null ? undefined : (params.ownerToken ?? TOKEN),
    rootDir: root,
    sourcePath: repo,
    worktreePath: params.worktreePath ?? worktree,
  });

const branches = () => git(repo, 'branch', '--format=%(refname:short)').split('\n');

describe('cleanupOwnedWorktree — clean / dirty', () => {
  it('removes a clean worktree, prunes it, and keeps the branch', async () => {
    await expect(run()).resolves.toEqual({ branch: BRANCH, outcome: 'removed' });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(worktree);
    expect(branches()).toContain(BRANCH);
  });

  it('does not count ignored files or unpushed commits as dirty', async () => {
    await mkdir(path.join(worktree, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(worktree, 'node_modules', 'pkg', 'index.js'), 'x');
    await writeFile(path.join(worktree, 'b.txt'), 'committed\n');
    git(worktree, 'add', 'b.txt');
    git(worktree, 'commit', '-m', 'unpushed');

    await expect(run()).resolves.toMatchObject({ outcome: 'removed' });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, 'log', '--format=%s', '-1', BRANCH)).toBe('unpushed');
  });

  it('keeps a worktree with tracked changes and counts them', async () => {
    await writeFile(path.join(worktree, 'a.txt'), 'changed\n');
    await expect(run()).resolves.toEqual({ branch: BRANCH, dirtyFiles: 1, outcome: 'dirty' });
    expect(existsSync(worktree)).toBe(true);
  });

  it('keeps a worktree with untracked files, counting each file', async () => {
    await mkdir(path.join(worktree, 'new'), { recursive: true });
    await writeFile(path.join(worktree, 'new', 'one.txt'), '1');
    await writeFile(path.join(worktree, 'new', 'two.txt'), '2');
    await writeFile(path.join(worktree, 'a.txt'), 'changed\n');
    await expect(run()).resolves.toMatchObject({ dirtyFiles: 3, outcome: 'dirty' });
  });

  it('keeps a worktree whose submodule holds uncommitted work', async () => {
    const lib = await tempDir('owt-lib-');
    await initRepo(lib);
    git(worktree, '-c', 'protocol.file.allow=always', 'submodule', 'add', lib, 'lib');
    git(worktree, 'commit', '-m', 'add submodule');
    await expect(countUncommittedFiles(worktree)).resolves.toBe(0);

    await writeFile(path.join(worktree, 'lib', 'scratch.txt'), 'only here');
    await expect(run()).resolves.toMatchObject({ dirtyFiles: 1, outcome: 'dirty' });
    expect(existsSync(path.join(worktree, 'lib', 'scratch.txt'))).toBe(true);
  });

  it('keeps a worktree whose submodule holds commits no remote has, until they are pushed', async () => {
    const lib = await tempDir('owt-lib-');
    await initRepo(lib);
    git(worktree, '-c', 'protocol.file.allow=always', 'submodule', 'add', lib, 'lib');
    git(worktree, 'commit', '-m', 'add submodule');
    // A commit made only inside the worktree's submodule, recorded by the parent.
    const sub = path.join(worktree, 'lib');
    git(sub, 'config', 'user.email', 'test@example.com');
    git(sub, 'config', 'user.name', 'Test');
    git(sub, 'config', 'commit.gpgsign', 'false');
    await writeFile(path.join(sub, 'local.txt'), 'only here\n');
    git(sub, 'add', 'local.txt');
    git(sub, 'commit', '-m', 'local submodule work');
    git(worktree, 'commit', '-am', 'bump submodule');
    await expect(countUncommittedFiles(worktree)).resolves.toBe(0);

    await expect(run()).resolves.toMatchObject({ outcome: 'dirty', unpushedSubmodules: 1 });
    expect(existsSync(path.join(sub, 'local.txt'))).toBe(true);

    // Once a remote branch holds it, nothing would be lost.
    git(sub, 'push', 'origin', 'HEAD:refs/heads/side');
    git(sub, 'fetch', 'origin');
    await expect(run()).resolves.toMatchObject({ outcome: 'removed' });
  });

  it('counts a staged rename once', async () => {
    git(worktree, 'mv', 'a.txt', 'renamed.txt');
    await expect(countUncommittedFiles(worktree)).resolves.toBe(1);
  });

  it('discard removes a dirty worktree, ignored files included, and keeps the branch', async () => {
    await writeFile(path.join(worktree, 'a.txt'), 'changed\n');
    await writeFile(path.join(worktree, 'untracked.txt'), 'u');
    await mkdir(path.join(worktree, 'node_modules'), { recursive: true });
    await writeFile(path.join(worktree, 'node_modules', 'x.js'), 'x');

    await expect(run({ discard: true })).resolves.toMatchObject({ outcome: 'removed' });
    expect(existsSync(worktree)).toBe(false);
    expect(branches()).toContain(BRANCH);
  });

  it('fully deletes the folder in place when git refuses to remove it', async () => {
    await mkdir(path.join(worktree, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(worktree, 'node_modules', 'pkg', 'index.js'), 'x');

    await expect(
      cleanupOwnedWorktree({
        // A file lock or a timeout: git gives up.
        gitRemove: async () => {
          throw new Error('fatal: cannot remove worktree');
        },
        ownerToken: TOKEN,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toEqual({ branch: BRANCH, outcome: 'removed' });

    expect(existsSync(worktree)).toBe(false);
    // A delete, not a move: nothing is parked anywhere under the root.
    expect(existsSync(path.join(root, '.trash'))).toBe(false);
    expect(await readdir(path.dirname(worktree))).toEqual([]);
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(worktree);
    expect(branches()).toContain(BRANCH);
  });

  it('reports a locked worktree and leaves it', async () => {
    git(repo, 'worktree', 'lock', worktree);
    await expect(run()).resolves.toEqual({ branch: BRANCH, outcome: 'locked' });
    await expect(run({ discard: true })).resolves.toMatchObject({ outcome: 'locked' });
    expect(existsSync(worktree)).toBe(true);
  });

  it('treats a folder that is already gone as removed and prunes its registration', async () => {
    await rm(worktree, { force: true, recursive: true });
    await expect(run()).resolves.toEqual({ outcome: 'removed' });
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(worktree);
  });
});

describe('cleanupOwnedWorktree — path guard', () => {
  it('refuses a relative path and `..` traversal out of the root', async () => {
    await expect(run({ worktreePath: 'repo/quiet-hill' })).resolves.toMatchObject({
      outcome: 'refused',
    });
    await expect(
      run({ worktreePath: path.join(root, '..', '..', path.basename(repo)) }),
    ).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(repo)).toBe(true);
  });

  it('refuses a worktree outside the root even when git lists it', async () => {
    const outside = path.join(await tempDir('owt-outside-'), 'wt');
    addWorktree(outside, 'lobehub/outside');
    await expect(run({ worktreePath: outside })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(outside)).toBe(true);
  });

  it('refuses a symlink inside the root that escapes it', async () => {
    const outside = path.join(await tempDir('owt-outside-'), 'wt');
    addWorktree(outside, 'lobehub/outside');
    const link = path.join(root, 'repo-1a2b3c4d', 'escape');
    await symlink(outside, link);

    await expect(run({ worktreePath: link })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(outside)).toBe(true);
  });

  it('refuses a folder in the root that the source repo does not list', async () => {
    const stray = path.join(root, 'repo-1a2b3c4d', 'stray');
    await mkdir(stray, { recursive: true });
    await writeFile(path.join(stray, 'keep.txt'), 'x');

    await expect(run({ worktreePath: stray })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(path.join(stray, 'keep.txt'))).toBe(true);
  });

  it('refuses a worktree of another repository', async () => {
    const other = await tempDir('owt-other-');
    await initRepo(other);
    const foreign = path.join(root, 'other-00000000', 'x');
    await mkdir(path.dirname(foreign), { recursive: true });
    git(other, 'worktree', 'add', '-b', 'lobehub/x', foreign);

    await expect(run({ worktreePath: foreign })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(foreign)).toBe(true);
  });

  it('refuses the main worktree', async () => {
    // A source repo cloned under the root: the path guard alone would pass.
    const mainUnderRoot = path.join(root, 'main-repo');
    await mkdir(mainUnderRoot, { recursive: true });
    await initRepo(mainUnderRoot);

    await expect(
      cleanupOwnedWorktree({
        rootDir: root,
        sourcePath: mainUnderRoot,
        worktreePath: mainUnderRoot,
      }),
    ).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(path.join(mainUnderRoot, '.git'))).toBe(true);
  });
});

describe('cleanupOwnedWorktree — creation receipt', () => {
  it('refuses a topic that claims the path without the receipt the app wrote', async () => {
    await expect(run({ ownerToken: 'someone-else-0123456789' })).resolves.toMatchObject({
      outcome: 'refused',
    });
    await expect(run({ discard: true, ownerToken: null })).resolves.toMatchObject({
      outcome: 'refused',
    });
    expect(existsSync(worktree)).toBe(true);
  });

  it('cleans up a worktree from before receipts only automatically, never by discard', async () => {
    const legacy = path.join(root, 'repo-1a2b3c4d', 'legacy');
    addWorktree(legacy, 'lobehub/legacy');
    await writeFile(path.join(legacy, 'scratch.txt'), 'x');

    await expect(
      run({ discard: true, ownerToken: null, worktreePath: legacy }),
    ).resolves.toMatchObject({
      outcome: 'refused',
    });
    expect(existsSync(path.join(legacy, 'scratch.txt'))).toBe(true);

    await rm(path.join(legacy, 'scratch.txt'));
    await expect(run({ ownerToken: null, worktreePath: legacy })).resolves.toMatchObject({
      outcome: 'removed',
    });
  });

  it('writes the receipt when the app creates the worktree', async () => {
    const created = path.join(root, 'repo-1a2b3c4d', 'created');
    await expect(
      addGitWorktree({
        branch: 'lobehub/created',
        ownerToken: TOKEN,
        path: repo,
        worktreePath: created,
      }),
    ).resolves.toMatchObject({ ownerToken: TOKEN, success: true });
    await expect(readOwnerMarker(created)).resolves.toBe(TOKEN);
    // Kept in git's admin dir for the worktree, not in its working tree.
    expect(existsSync(path.join(created, OWNER_MARKER_FILE))).toBe(false);
    await expect(run({ worktreePath: created })).resolves.toMatchObject({ outcome: 'removed' });
  });

  it('gives detached-HEAD commits a branch before removing the worktree', async () => {
    git(worktree, 'checkout', '--detach');
    await writeFile(path.join(worktree, 'b.txt'), 'only on a detached HEAD\n');
    git(worktree, 'add', 'b.txt');
    git(worktree, 'commit', '-m', 'detached work');
    const head = git(worktree, 'rev-parse', 'HEAD');

    const result = await run();
    expect(result).toEqual({ branch: `lobehub/detached-${head.slice(0, 12)}`, outcome: 'removed' });
    expect(git(repo, 'rev-parse', result.branch!)).toBe(head);
  });
});

describe('restoreOwnedWorktree', () => {
  it('checks the branch out again at the original path', async () => {
    await writeFile(path.join(worktree, 'b.txt'), 'kept on branch\n');
    git(worktree, 'add', 'b.txt');
    git(worktree, 'commit', '-m', 'work');
    await run();
    expect(existsSync(worktree)).toBe(false);

    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        ownerToken: TOKEN,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toEqual({ outcome: 'restored' });
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
    // The receipt comes back with it, so the next cleanup is still this topic's.
    await expect(readOwnerMarker(worktree)).resolves.toBe(TOKEN);
    expect(existsSync(path.join(worktree, 'b.txt'))).toBe(true);
  });

  it('waits for a removal still in flight before checking the worktree out again', async () => {
    let release!: () => void;
    const slowRemove = new Promise<void>((resolve) => (release = resolve));
    const cleaning = cleanupOwnedWorktree({
      // A large worktree: git is still deleting when the restore arrives.
      gitRemove: async (source, target) => {
        await slowRemove;
        git(source, 'worktree', 'remove', '--force', target);
      },
      ownerToken: TOKEN,
      rootDir: root,
      sourcePath: repo,
      worktreePath: worktree,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const restoring = restoreOwnedWorktree({
      branch: BRANCH,
      ownerToken: TOKEN,
      rootDir: root,
      sourcePath: repo,
      worktreePath: worktree,
    });
    release();

    await expect(cleaning).resolves.toMatchObject({ outcome: 'removed' });
    await expect(restoring).resolves.toEqual({ outcome: 'restored' });
    // Re-added after the deletion, not swept away by it.
    expect(existsSync(path.join(worktree, '.git'))).toBe(true);
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
  });

  it('is a no-op when the worktree is already there on its branch', async () => {
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toEqual({ outcome: 'restored' });
  });

  it('reports a deleted branch without creating anything', async () => {
    await run();
    git(repo, 'branch', '-D', BRANCH);
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toEqual({ outcome: 'branchMissing' });
    expect(existsSync(worktree)).toBe(false);
  });

  it('reports an unreadable source repository as an error, never as a missing branch', async () => {
    await run();
    await rm(path.join(repo, '.git'), { force: true, recursive: true });
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toMatchObject({ outcome: 'error' });
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: path.join(repo, 'unmounted'),
        worktreePath: worktree,
      }),
    ).resolves.toMatchObject({ outcome: 'error' });
  });

  it('refuses a path outside the root', async () => {
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: path.join(path.dirname(root), 'elsewhere'),
      }),
    ).resolves.toMatchObject({ outcome: 'refused' });
  });
});
