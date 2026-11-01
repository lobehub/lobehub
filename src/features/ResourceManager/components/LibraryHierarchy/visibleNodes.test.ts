import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { toTreeItem } from '@/store/tree';

import { buildVisibleNodes } from './visibleNodes';

const folder = toTreeItem({ fileType: CUSTOM_FOLDER_FILE_TYPE, id: 'folder', name: 'test' });
const nested = toTreeItem({ fileType: CUSTOM_FOLDER_FILE_TYPE, id: 'nested', name: 'inner' });
const docA = toTreeItem({ fileType: 'custom/document', id: 'doc-a', name: 'A' });
const docB = toTreeItem({ fileType: 'custom/document', id: 'doc-b', name: 'B' });

describe('buildVisibleNodes', () => {
  it('walks expanded folders depth first with their level and parent key', () => {
    const nodes = buildVisibleNodes(
      { '': [folder, docB], 'folder': [nested, docA], 'nested': [] },
      { folder: true },
    );

    expect(nodes.map((n) => [n.key, n.level, n.parentKey])).toEqual([
      ['folder', 0, ''],
      ['nested', 1, 'folder'],
      ['doc-a', 1, 'folder'],
      ['doc-b', 0, ''],
    ]);
  });

  it('skips the children of a collapsed folder', () => {
    const nodes = buildVisibleNodes({ '': [folder], 'folder': [docA] }, {});

    expect(nodes.map((n) => n.key)).toEqual(['folder']);
  });

  it('walks into an expanded document that holds other documents', () => {
    // Regression: only folders were walked, so a page nested under another page
    // never showed up in the library tree.
    const parentDoc = toTreeItem({
      fileType: 'custom/document',
      hasChildren: true,
      id: 'parent-doc',
      name: 'Parent',
    });
    const nodes = buildVisibleNodes(
      { '': [parentDoc, docB], 'parent-doc': [docA] },
      { 'parent-doc': true },
    );

    expect(nodes.map((n) => [n.key, n.level, n.parentKey])).toEqual([
      ['parent-doc', 0, ''],
      ['doc-a', 1, 'parent-doc'],
      ['doc-b', 0, ''],
    ]);
  });

  it('renders a row that two folder caches both list only once', () => {
    // Optimistic move put doc-a under the folder while the Explorer's
    // reconcile still lists it at the root.
    const nodes = buildVisibleNodes({ '': [folder, docA], 'folder': [docA] }, { folder: true });

    expect(nodes.map((n) => n.key)).toEqual(['folder', 'doc-a']);
    expect(nodes.filter((n) => n.key === 'doc-a')).toHaveLength(1);
  });
});
