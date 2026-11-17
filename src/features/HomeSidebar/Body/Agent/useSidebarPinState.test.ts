import { describe, expect, it } from 'vitest';

import { resolveSidebarPinState, resolveSidebarRowMarks } from './useSidebarPinState';

describe('resolveSidebarPinState', () => {
  it('personal mode: the column is the user own pin, no team pins', () => {
    expect(
      resolveSidebarPinState(
        { id: 'a', pinned: true, visibility: 'public' },
        { isWorkspace: false, myPinnedIds: [] },
      ),
    ).toEqual({ isMyPinned: true, isPrivate: false, isTeamPinned: false, isWorkspace: false });
  });

  it('workspace public row: the column is the team pin, the preference is mine', () => {
    expect(
      resolveSidebarPinState(
        { id: 'a', pinned: true, visibility: 'public' },
        { isWorkspace: true, myPinnedIds: [] },
      ),
    ).toMatchObject({ isMyPinned: false, isTeamPinned: true });
    expect(
      resolveSidebarPinState(
        { id: 'a', pinned: false, visibility: 'public' },
        { isWorkspace: true, myPinnedIds: ['a'] },
      ),
    ).toMatchObject({ isMyPinned: true, isTeamPinned: false });
  });

  it('workspace private row: its column is the creator own pin, never a team pin', () => {
    expect(
      resolveSidebarPinState(
        { id: 'p', pinned: true, visibility: 'private' },
        { isWorkspace: true, myPinnedIds: [] },
      ),
    ).toEqual({ isMyPinned: true, isPrivate: true, isTeamPinned: false, isWorkspace: true });
  });
});

describe('resolveSidebarRowMarks', () => {
  const state = (input: Parameters<typeof resolveSidebarPinState>[0], isWorkspace: boolean) =>
    resolveSidebarPinState(input, { isWorkspace, myPinnedIds: [] });

  it('marks a private workspace row with the lock', () => {
    expect(
      resolveSidebarRowMarks(state({ id: 'p', pinned: false, visibility: 'private' }, true)),
    ).toEqual({ showLock: true, showPin: false });
  });

  it('leaves the lock to the folder header inside a private folder', () => {
    expect(
      resolveSidebarRowMarks(state({ id: 'p', pinned: false, visibility: 'private' }, true), {
        inPrivateFolder: true,
      }),
    ).toEqual({ showLock: false, showPin: false });
  });

  it('leaves the pin to a pinned section header', () => {
    expect(
      resolveSidebarRowMarks(state({ id: 'a', pinned: true, visibility: 'public' }, true), {
        pinnedByHeader: true,
      }),
    ).toEqual({ showLock: false, showPin: false });
    expect(
      resolveSidebarRowMarks(state({ id: 'p', pinned: true, visibility: 'private' }, true), {
        pinnedByHeader: true,
      }),
    ).toEqual({ showLock: true, showPin: false });
  });

  it('keeps the row pin where no header names it', () => {
    // e.g. the All Agents drawer, which lists workspace rows without sections
    expect(
      resolveSidebarRowMarks(state({ id: 'a', pinned: true, visibility: 'public' }, true)),
    ).toEqual({ showLock: false, showPin: true });
    expect(
      resolveSidebarRowMarks(state({ id: 'a', pinned: true, visibility: 'private' }, false)),
    ).toEqual({ showLock: false, showPin: true });
  });
});
