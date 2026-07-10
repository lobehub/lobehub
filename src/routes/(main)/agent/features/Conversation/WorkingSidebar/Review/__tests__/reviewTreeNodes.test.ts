import type { GitWorkingTreePatch } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { buildReviewTreeNodes, itemKey } from '../reviewTreeNodes';

const makePatch = (filePath: string): GitWorkingTreePatch => ({
  additions: 1,
  deletions: 0,
  filePath,
  isBinary: false,
  patch: '',
  status: 'modified',
  truncated: false,
});

const group = (absolutePath: string, name: string, paths: string[]) => ({
  absolutePath,
  name,
  patches: paths.map(makePatch),
});

describe('buildReviewTreeNodes', () => {
  it('materialises each directory in the chain once and parents files/dirs correctly', () => {
    const nodes = buildReviewTreeNodes([group('/repo', 'repo', ['src/a/b.ts', 'src/c.ts'])], false);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    // `src` and `src/a` directories exist exactly once each.
    expect(nodes.filter((n) => n.isFolder && n.name === 'src')).toHaveLength(1);
    expect(nodes.filter((n) => n.isFolder && n.name === 'a')).toHaveLength(1);
    // File nodes carry the diff key and hang off their immediate directory.
    const leaf = nodes.find((n) => n.name === 'b.ts');
    expect(leaf?.isFolder).toBe(false);
    expect(leaf?.data?.key).toBe(itemKey('/repo', makePatch('src/a/b.ts')));
    expect(byId.get(leaf!.parentId as string)?.name).toBe('a');
    // Top-level file has a null parent when there are no group headers.
    expect(nodes.find((n) => n.name === 'c.ts')?.parentId).toBe(byId.get('/repo\u0000src/')?.id);
  });

  it('adds a group-root folder per repo when group headers are shown', () => {
    const nodes = buildReviewTreeNodes(
      [group('/repo', 'repo', ['a.ts']), group('/repo/sub', 'sub', ['x.ts'])],
      true,
    );

    const roots = nodes.filter((n) => n.isFolder && n.parentId === null);
    expect(roots.map((n) => n.name).sort()).toEqual(['repo', 'sub']);
    // The file in the parent repo hangs off that repo's root node.
    const aNode = nodes.find((n) => n.name === 'a.ts');
    const repoRoot = roots.find((n) => n.name === 'repo');
    expect(aNode?.parentId).toBe(repoRoot?.id);
  });

  it('skips empty groups', () => {
    const nodes = buildReviewTreeNodes([group('/repo', 'repo', [])], true);
    expect(nodes).toHaveLength(0);
  });
});
