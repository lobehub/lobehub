import { describe, expect, it } from 'vitest';

import { buildPageTree } from './tree';

const rowsOf = (docs: { id: string; parentId?: string | null }[]) =>
  buildPageTree(docs).map(({ depth, doc }) => `${'-'.repeat(depth)}${doc.id}`);

describe('buildPageTree', () => {
  it('keeps a flat list flat and in order', () => {
    expect(rowsOf([{ id: 'b' }, { id: 'a', parentId: null }])).toEqual(['b', 'a']);
  });

  it('nests a page under its parent', () => {
    expect(
      rowsOf([
        { id: 'child', parentId: 'parent' },
        { id: 'other' },
        { id: 'parent' },
        { id: 'grandchild', parentId: 'child' },
      ]),
    ).toEqual(['other', 'parent', '-child', '--grandchild']);
  });

  it('treats a page whose parent is not listed as a root', () => {
    expect(rowsOf([{ id: 'orphan', parentId: 'missing' }])).toEqual(['orphan']);
  });

  it('still lists pages caught in a parent cycle', () => {
    expect(
      rowsOf([
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]),
    ).toEqual(['a', '-b']);
  });
});
