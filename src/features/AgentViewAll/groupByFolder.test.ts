import type { SidebarAgentItem, SidebarGroup } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupItemsByFolder } from './groupByFolder';

const item = (id: string, groupId?: string) =>
  ({
    groupId,
    id,
    pinned: false,
    title: id,
    type: 'agent',
    updatedAt: new Date(),
  }) as SidebarAgentItem;
const folder = (id: string) => ({ id, items: [], name: id.toUpperCase(), sort: 0 }) as SidebarGroup;

describe('groupItemsByFolder', () => {
  it('buckets rows by folder in folder order, loose rows last', () => {
    const sections = groupItemsByFolder(
      [item('a', 'f2'), item('b'), item('c', 'f1'), item('d', 'f2')],
      [folder('f1'), folder('f2')],
      'No folder',
    );

    expect(sections.map((s) => [s.key, s.label, s.items.map((i) => i.id)])).toEqual([
      ['folder:f1', 'F1', ['c']],
      ['folder:f2', 'F2', ['a', 'd']],
      ['folder:none', 'No folder', ['b']],
    ]);
  });

  it('keeps empty folders in the shared catalogue', () => {
    const sections = groupItemsByFolder([], [folder('empty')], 'No folder');

    expect(sections.map((s) => s.key)).toEqual(['folder:empty']);
  });

  it('treats a row pointing at an unknown folder as loose', () => {
    const sections = groupItemsByFolder([item('a', 'gone')], [], 'No folder');

    expect(sections.map((s) => s.key)).toEqual(['folder:none']);
  });
});
