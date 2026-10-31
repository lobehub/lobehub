// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inventoryScope } from '../analysis/scopeInventory';
import { exportSourceTree, prepareSourceSnapshots } from '../source/buildSnapshots';
import { git } from '../source/git';
import {
  closeRevisionSession,
  createRevisionSession,
  resolveCommit,
} from '../source/revisionResolver';

const owned: string[] = [];
const sessions: Awaited<ReturnType<typeof createRevisionSession>>[] = [];
const repository = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-verification-test-'));
  owned.push(root);
  await git(root, ['init', '-b', 'canary']);
  await git(root, ['config', 'user.name', 'Style verifier tests']);
  await git(root, ['config', 'user.email', 'style-verifier@example.invalid']);
  await writeFile(path.join(root, 'package.json'), '{"name":"fixture"}');
  await writeFile(path.join(root, 'component.ts'), 'export const color = "red";');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'base']);
  return root;
};
const commit = async (root: string, file: string, text: string) => {
  await writeFile(path.join(root, file), text);
  await git(root, ['add', file]);
  await git(root, ['commit', '-m', file]);
  return resolveCommit(root, 'HEAD');
};

afterEach(async () => {
  for (const session of sessions.splice(0)) await closeRevisionSession(session);
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});

describe('isolated B → merge-candidate source pipeline', () => {
  it('includes concurrent base changes and never borrows dirty checkout sources', async () => {
    const root = await repository();
    const ancestor = await resolveCommit(root, 'HEAD');
    await git(root, ['switch', '-c', 'migration']);
    const head = await commit(root, 'component.ts', 'export const color = "blue";');
    await git(root, ['switch', 'canary']);
    const base = await commit(root, 'host.ts', 'export const width = 600;');
    await writeFile(path.join(root, 'component.ts'), 'DIRTY_WORKTREE_MUST_NOT_LEAK');
    const status = await git(root, ['status', '--porcelain=v1']);
    const session = await createRevisionSession(root, base, head);
    sessions.push(session);
    const output = path.join(root, 'output');
    await mkdir(output);
    const snapshots = await prepareSourceSnapshots(session, output);
    expect(await readFile(path.join(snapshots.base.directory, 'component.ts'), 'utf8')).toContain(
      'red',
    );
    expect(
      await readFile(path.join(snapshots.candidate.directory, 'component.ts'), 'utf8'),
    ).toContain('blue');
    expect(await readFile(path.join(snapshots.candidate.directory, 'host.ts'), 'utf8')).toContain(
      '600',
    );
    expect(session.identity.baseSha).not.toBe(ancestor);
    expect((await git(root, ['status', '--porcelain=v1', '--untracked-files=no'])).toString()).toBe(
      status.toString(),
    );
    // The merge object is written only to the scratch object database.
    await expect(
      git(root, ['cat-file', '-e', session.identity.candidateTreeSha]),
    ).rejects.toThrow();
    expect(snapshots.base.dependencyRestore).toBe('NOT_RESTORED');
    expect(snapshots.base.dependencyInputHash).toBe(snapshots.candidate.dependencyInputHash);
    const scope = await inventoryScope(session);
    expect(scope.changedFiles).toEqual([
      { after: 'component.ts', before: 'component.ts', status: 'M' },
    ]);
    expect(scope.units.map((unit) => unit.side)).toEqual(['base', 'candidate']);
    expect(scope.limitations).toContain('TRANSITIVE_IMPACT_UNPROVEN');
  });

  it('refuses conflicting merge candidates', async () => {
    const root = await repository();
    await git(root, ['switch', '-c', 'migration']);
    const head = await commit(root, 'component.ts', 'export const color = "blue";');
    await git(root, ['switch', 'canary']);
    const base = await commit(root, 'component.ts', 'export const color = "green";');
    await expect(createRevisionSession(root, base, head)).rejects.toThrow();
    expect(await resolveCommit(root, 'HEAD')).toBe(base);
  });

  it('keeps deletions and both source sides in the inventory', async () => {
    const root = await repository();
    const base = await resolveCommit(root, 'HEAD');
    await git(root, ['rm', 'component.ts']);
    await git(root, ['commit', '-m', 'remove']);
    const session = await createRevisionSession(root, base, 'HEAD');
    sessions.push(session);
    const scope = await inventoryScope(session);
    expect(scope.changedFiles).toContainEqual({
      after: undefined,
      before: 'component.ts',
      status: 'D',
    });
    expect(scope.units).toHaveLength(1);
    expect(scope.units[0]).toMatchObject({ file: 'component.ts', side: 'base' });
  });

  it('never overwrites an existing export directory', async () => {
    const root = await repository();
    const destination = path.join(root, 'existing');
    await mkdir(destination);
    await writeFile(path.join(destination, 'keep.txt'), 'preserve');
    await expect(
      exportSourceTree(root, await resolveCommit(root, 'HEAD'), destination),
    ).rejects.toThrow();
    expect(await readFile(path.join(destination, 'keep.txt'), 'utf8')).toBe('preserve');
  });

  it('rejects shell/option-like revisions without invoking a shell', async () => {
    const root = await repository();
    for (const ref of ['--help', 'HEAD\nHEAD', '$(touch injected)', ''])
      await expect(resolveCommit(root, ref)).rejects.toThrow('INVALID_REVISION');
  });

  it('accepts shallow history only when the complete B/H-to-merge-base region exists', async () => {
    const root = await repository();
    const base = await resolveCommit(root, 'HEAD');
    const head = await commit(root, 'component.ts', 'export const color = "blue";');
    await writeFile(path.join(root, '.git/shallow'), base + '\n');
    const session = await createRevisionSession(root, base, head);
    sessions.push(session);
    expect(session.identity.headSha).toBe(head);
    await writeFile(path.join(root, '.git/shallow'), head + '\n');
    await expect(createRevisionSession(root, base, head)).rejects.toThrow();
  });

  it('rejects external source symlinks without touching their destination', async () => {
    const root = await repository();
    const outside = await mkdtemp(path.join(tmpdir(), 'stylex-verification-test-'));
    owned.push(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'preserve');
    await symlink(outside, path.join(root, 'escape'));
    await git(root, ['add', 'escape']);
    await git(root, ['commit', '-m', 'external-link']);
    await expect(
      exportSourceTree(root, await resolveCommit(root, 'HEAD'), path.join(root, 'export')),
    ).rejects.toThrow('EXTERNAL_SOURCE_SYMLINK');
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('preserve');
  });

  it('exports safe internal links but refuses chains that defeat lexical containment', async () => {
    const root = await repository();
    await symlink('component.ts', path.join(root, 'alias.ts'));
    await git(root, ['add', 'alias.ts']);
    await git(root, ['commit', '-m', 'internal-link']);
    const first = path.join(root, 'first-export');
    await exportSourceTree(root, await resolveCommit(root, 'HEAD'), first);
    expect(await readFile(path.join(first, 'alias.ts'), 'utf8')).toContain('red');
    await symlink('alias.ts', path.join(root, 'chain.ts'));
    await git(root, ['add', 'chain.ts']);
    await git(root, ['commit', '-m', 'link-chain']);
    await expect(
      exportSourceTree(root, await resolveCommit(root, 'HEAD'), path.join(root, 'second-export')),
    ).rejects.toThrow('SOURCE_SYMLINK_CHAIN_UNSUPPORTED');
  });
});
