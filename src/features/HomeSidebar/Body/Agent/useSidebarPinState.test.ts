import { describe, expect, it } from 'vitest';

import { resolveSidebarPinState } from './useSidebarPinState';

describe('resolveSidebarPinState', () => {
  it('personal mode: the column is the user own pin', () => {
    expect(
      resolveSidebarPinState(
        { id: 'a', pinned: true, visibility: 'public' },
        { isWorkspace: false, myPinnedIds: [] },
      ),
    ).toEqual({ isMyPinned: true, isPrivate: false, isWorkspace: false });
  });

  it('workspace public row: a legacy team pin pins nothing, the preference is mine', () => {
    expect(
      resolveSidebarPinState(
        { id: 'a', pinned: true, visibility: 'public' },
        { isWorkspace: true, myPinnedIds: [] },
      ),
    ).toMatchObject({ isMyPinned: false });
    expect(
      resolveSidebarPinState(
        { id: 'a', pinned: false, visibility: 'public' },
        { isWorkspace: true, myPinnedIds: ['a'] },
      ),
    ).toMatchObject({ isMyPinned: true });
  });

  it('workspace private row: its column is the creator own pin', () => {
    expect(
      resolveSidebarPinState(
        { id: 'p', pinned: true, visibility: 'private' },
        { isWorkspace: true, myPinnedIds: [] },
      ),
    ).toEqual({ isMyPinned: true, isPrivate: true, isWorkspace: true });
  });

  it('workspace public row: a team pin counts as mine while the server is about to copy it in', () => {
    expect(
      resolveSidebarPinState(
        { id: 'a', pinned: true, visibility: 'public' },
        { isWorkspace: true, myPinnedIds: [], previewTeamPins: true },
      ),
    ).toMatchObject({ isMyPinned: true });
  });
});
