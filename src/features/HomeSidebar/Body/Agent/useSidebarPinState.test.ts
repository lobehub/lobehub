import { describe, expect, it } from 'vitest';

import { resolveSidebarPinState } from './useSidebarPinState';

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
