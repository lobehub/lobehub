import type { SidebarAgentItem, SidebarGroup } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  isListedInWorkspaceSidebar,
  resolveWorkspaceAgentSections,
} from './workspaceAgentSections';

const ME = 'me';

const item = (
  id: string,
  visibility: 'private' | 'public',
  updatedAt: string,
  extra: Partial<SidebarAgentItem> = {},
): SidebarAgentItem =>
  ({
    id,
    pinned: false,
    title: id,
    type: 'agent',
    updatedAt: new Date(updatedAt),
    // Private rows are always the caller's; public rows default to a teammate.
    userId: visibility === 'private' ? ME : 'teammate',
    visibility,
    ...extra,
  }) as SidebarAgentItem;

const mine = { userId: ME };

const folder = (id: string, visibility: 'private' | 'public', items: SidebarAgentItem[]) =>
  ({ id, items, name: id, sort: 0, visibility }) as SidebarGroup;

const ids = (items: { id: string }[]) => items.map((i) => i.id);

const base = {
  currentUserId: ME,
  groups: [] as SidebarGroup[],
  myPinnedIds: [] as string[],
  pinned: [] as SidebarAgentItem[],
  privateGroups: [] as SidebarGroup[],
  privatePinned: [] as SidebarAgentItem[],
  privateUngrouped: [] as SidebarAgentItem[],
  ungrouped: [] as SidebarAgentItem[],
  visibilityOverrides: {} as Record<string, boolean>,
};

describe('isListedInWorkspaceSidebar', () => {
  const membership = { currentUserId: ME, visibilityOverrides: {} };

  it('lists the member’s own rows: private ones and ones they created', () => {
    expect(isListedInWorkspaceSidebar(item('p', 'private', '2026-01-01'), membership)).toBe(true);
    expect(isListedInWorkspaceSidebar(item('c', 'public', '2026-01-01', mine), membership)).toBe(
      true,
    );
  });

  it('leaves a teammate’s shared row on the Agents page until the member adds it', () => {
    expect(isListedInWorkspaceSidebar(item('t', 'public', '2026-01-01'), membership)).toBe(false);
  });

  it('lets an explicit choice win over the default', () => {
    const overrides = { added: true, hiddenOwn: false };
    const withOverrides = { currentUserId: ME, visibilityOverrides: overrides };

    expect(isListedInWorkspaceSidebar(item('added', 'public', '2026-01-01'), withOverrides)).toBe(
      true,
    );
    // A member can hide even a row they created.
    expect(
      isListedInWorkspaceSidebar(item('hiddenOwn', 'public', '2026-01-01', mine), withOverrides),
    ).toBe(false);
  });
});

describe('resolveWorkspaceAgentSections', () => {
  it('puts team pins, my pins, private folders and the rest in that order of sections', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      groups: [folder('pub-folder', 'public', [item('in-pub-folder', 'public', '2026-01-01')])],
      myPinnedIds: ['pub-mine'],
      pinned: [item('team', 'public', '2026-01-01', { pinned: true })],
      privateGroups: [
        folder('priv-folder', 'private', [item('in-priv-folder', 'private', '2026-01-01')]),
      ],
      privatePinned: [item('legacy-private-pin', 'private', '2026-01-02', { pinned: true })],
      privateUngrouped: [item('priv-rest', 'private', '2026-01-05')],
      ungrouped: [
        item('pub-mine', 'public', '2026-01-03'),
        item('pub-rest', 'public', '2026-01-04', mine),
      ],
    });

    expect(ids(sections.teamPinned)).toEqual(['team']);
    // Preference order first, then private rows pinned through their column.
    expect(ids(sections.myPinned)).toEqual(['pub-mine', 'legacy-private-pin']);
    // Only private folders stay in the sidebar.
    expect(ids(sections.folders)).toEqual(['priv-folder']);
    // Public and private rows interleave, newest first.
    expect(ids(sections.rest)).toEqual(['priv-rest', 'pub-rest']);
  });

  it('keeps every pre-existing pin: public column → team, private column → mine', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      pinned: [item('old-public-pin', 'public', '2026-01-01', { pinned: true })],
      privatePinned: [item('old-private-pin', 'private', '2026-01-01', { pinned: true })],
    });

    expect(ids(sections.teamPinned)).toEqual(['old-public-pin']);
    expect(ids(sections.myPinned)).toEqual(['old-private-pin']);
  });

  it('moves public folders off the sidebar but keeps the member’s own and added rows', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      groups: [
        folder('catalogue', 'public', [
          item('teammates', 'public', '2026-01-01'),
          item('i-created', 'public', '2026-01-02', mine),
          item('i-added', 'public', '2026-01-03'),
        ]),
      ],
      visibilityOverrides: { 'i-added': true },
    });

    expect(sections.folders).toEqual([]);
    expect(ids(sections.rest)).toEqual(['i-added', 'i-created']);
  });

  it('lists every row once: a personal pin leaves its folder and the rest', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      myPinnedIds: ['a', 'c'],
      privateGroups: [
        folder('f', 'private', [
          item('a', 'private', '2026-01-01'),
          item('b', 'private', '2026-01-01'),
        ]),
      ],
      ungrouped: [item('c', 'public', '2026-01-01'), item('d', 'public', '2026-01-01', mine)],
    });

    expect(ids(sections.myPinned)).toEqual(['a', 'c']);
    expect(ids(sections.folders[0].items)).toEqual(['b']);
    expect(ids(sections.rest)).toEqual(['d']);
  });

  it('never repeats a team pin under my pins', () => {
    const sections = resolveWorkspaceAgentSections({
      ...base,
      myPinnedIds: ['team'],
      pinned: [item('team', 'public', '2026-01-01', { pinned: true })],
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
    const pinnedPrivate = item('p', 'private', '2026-01-01', { pinned: true });
    const sections = resolveWorkspaceAgentSections({
      ...base,
      myPinnedIds: ['p'],
      privatePinned: [pinnedPrivate],
    });

    expect(ids(sections.myPinned)).toEqual(['p']);
  });
});
