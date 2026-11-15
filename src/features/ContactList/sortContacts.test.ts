import type { SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupContacts, sortContacts } from './sortContacts';

const item = (id: string, title: string, updatedAt: string): SidebarAgentItem =>
  ({ id, pinned: false, title, type: 'agent', updatedAt: new Date(updatedAt) }) as SidebarAgentItem;

const items = [
  item('b', 'Beta', '2026-11-10T00:00:00Z'),
  item('a', 'Alpha', '2026-11-01T00:00:00Z'),
  item('c', 'Gamma', '2026-11-12T00:00:00Z'),
  item('d', 'Delta', '2026-11-10T00:00:00Z'),
];

describe('sortContacts', () => {
  it('orders by name', () => {
    expect(sortContacts(items, 'title', 'Untitled').map((i) => i.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('orders the most recently updated first, ties by name', () => {
    expect(sortContacts(items, 'updatedAt', 'Untitled').map((i) => i.id)).toEqual([
      'c',
      'b',
      'd',
      'a',
    ]);
  });

  it('does not mutate the input', () => {
    sortContacts(items, 'updatedAt', 'Untitled');
    expect(items.map((i) => i.id)).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('groupContacts', () => {
  it('leads with pinned contacts of either kind and leaves them out of their own section', () => {
    const group = (id: string, title: string, pinned: boolean) =>
      ({ ...item(id, title, '2026-11-01T00:00:00Z'), pinned, type: 'group' }) as SidebarAgentItem;
    const sections = groupContacts(
      [
        { ...items[0], pinned: true },
        items[1],
        group('g', 'Omega', true),
        group('h', 'Delta group', false),
      ],
      'title',
      'Untitled',
    );

    expect(sections.pinned.map((i) => i.id)).toEqual(['b', 'g']);
    expect(sections.groups.map((i) => i.id)).toEqual(['h']);
    expect(sections.agents.map((i) => i.id)).toEqual(['a']);
  });
});
