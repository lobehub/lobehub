import type { SidebarAgentItem, SidebarGroup } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveWorkspaceAgentSections } from './workspaceAgentSections';

const item = (
  id: string,
  visibility: 'private' | 'public',
  updatedAt: string,
  pinned = false,
): SidebarAgentItem =>
  ({
    id,
    pinned,
    title: id,
    type: 'agent',
    updatedAt: new Date(updatedAt),
    visibility,
  }) as SidebarAgentItem;

const folder = (id: string, visibility: 'private' | 'public', items: SidebarAgentItem[]) =>
  ({ id, items, name: id, sort: 0, visibility }) as SidebarGroup;

const ids = (items: { id: string }[]) => items.map((i) => i.id);

const base = {
  groups: [] as SidebarGroup[],
  myPinnedIds: [] as string[],
  pinned: [] as SidebarAgentItem[],
  privateGroups: [] as SidebarGroup[],
  privatePinned: [] as SidebarAgentItem[],
  privateUngrouped: [] as SidebarAgentItem[],
  ungrouped: [] as SidebarAgentItem[],
};

describe('resolveWorkspaceAgentSections', () => {
  it('puts team pins, my pins, folders and the rest in that order of sections', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      groups: [folder('pub-folder', 'public', [item('in-pub-folder', 'public', '2026-01-01')])],
      myPinnedIds: ['pub-mine'],
      pinned: [item('team', 'public', '2026-01-01', true)],
      privateGroups: [
        folder('priv-folder', 'private', [item('in-priv-folder', 'private', '2026-01-01')]),
      ],
      privatePinned: [item('legacy-private-pin', 'private', '2026-01-02', true)],
      privateUngrouped: [item('priv-rest', 'private', '2026-01-05')],
      ungrouped: [
        item('pub-mine', 'public', '2026-01-03'),
        item('pub-rest', 'public', '2026-01-04'),
      ],
    });

    expect(ids(sections.teamPinned)).toEqual(['team']);
    // Preference order first, then private rows pinned through their column.
    expect(ids(sections.myPinned)).toEqual(['pub-mine', 'legacy-private-pin']);
    // Public folders before private ones.
    expect(ids(sections.folders)).toEqual(['pub-folder', 'priv-folder']);
    // Public and private rows interleave, newest first.
    expect(ids(sections.rest)).toEqual(['priv-rest', 'pub-rest']);
  });

  it('keeps every pre-existing pin: public column → team, private column → mine', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      pinned: [item('old-public-pin', 'public', '2026-01-01', true)],
      privatePinned: [item('old-private-pin', 'private', '2026-01-01', true)],
    });

    expect(ids(sections.teamPinned)).toEqual(['old-public-pin']);
    expect(ids(sections.myPinned)).toEqual(['old-private-pin']);
  });

  it('lists every row once: a personal pin leaves its folder and the rest', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      groups: [
        folder('f', 'public', [
          item('a', 'public', '2026-01-01'),
          item('b', 'public', '2026-01-01'),
        ]),
      ],
      myPinnedIds: ['a', 'c'],
      ungrouped: [item('c', 'public', '2026-01-01'), item('d', 'public', '2026-01-01')],
    });

    expect(ids(sections.myPinned)).toEqual(['a', 'c']);
    expect(ids(sections.folders[0].items)).toEqual(['b']);
    expect(ids(sections.rest)).toEqual(['d']);
  });

  it('never repeats a team pin under my pins', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      myPinnedIds: ['team'],
      pinned: [item('team', 'public', '2026-01-01', true)],
    });

    expect(ids(sections.teamPinned)).toEqual(['team']);
    expect(sections.myPinned).toEqual([]);
  });

  it('skips dangling personal pins of rows that no longer exist', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      myPinnedIds: ['deleted', 'kept'],
      ungrouped: [item('kept', 'public', '2026-01-01')],
    });

    expect(ids(sections.myPinned)).toEqual(['kept']);
  });

  it('dedupes a private pin recorded both in the preference and on the column', () => {
    const pinnedPrivate = item('p', 'private', '2026-01-01', true);
    const sections = resolveWorkspaceAgentSections({
      ...base,
      myPinnedIds: ['p'],
      privatePinned: [pinnedPrivate],
    });

    expect(ids(sections.myPinned)).toEqual(['p']);
  });
});
