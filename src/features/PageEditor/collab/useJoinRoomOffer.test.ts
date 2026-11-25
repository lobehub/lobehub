import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useJoinRoomOffer } from './useJoinRoomOffer';

const mocks = vi.hoisted(() => ({
  available: true,
  labEnabled: false,
  lockHolderOwnerId: undefined as string | undefined,
  updateLab: vi.fn(),
}));

vi.mock('../store', () => ({
  usePageEditorStore: (selector: any) => selector({ lockHolderOwnerId: mocks.lockHolderOwnerId }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) =>
    selector({
      preference: { lab: { enablePageCollab: mocks.labEnabled } },
      updateLab: mocks.updateLab,
    }),
}));

vi.mock('./usePageCollab', () => ({ usePageCollabAvailable: () => mocks.available }));

const offer = () => renderHook(() => useJoinRoomOffer()).result.current;

describe('useJoinRoomOffer', () => {
  beforeEach(() => {
    mocks.available = true;
    mocks.labEnabled = false;
    mocks.lockHolderOwnerId = 'room:doc-1:abc';
    mocks.updateLab.mockReset();
  });

  it('offers to turn on the lab when the lock holder edits in the room', () => {
    const turnOn = offer();

    turnOn?.();

    expect(mocks.updateLab).toHaveBeenCalledWith({ enablePageCollab: true });
  });

  it('offers nothing when the lock holder edits outside the room', () => {
    mocks.lockHolderOwnerId = 'page:doc-1:abc';

    expect(offer()).toBeUndefined();
  });

  it('offers nothing where the deployment runs no rooms', () => {
    mocks.available = false;

    expect(offer()).toBeUndefined();
  });

  it('offers nothing once the lab is on', () => {
    mocks.labEnabled = true;

    expect(offer()).toBeUndefined();
  });
});
