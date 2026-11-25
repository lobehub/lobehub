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

const offer = (lockedBySelf = false) =>
  renderHook(() => useJoinRoomOffer(lockedBySelf)).result.current;

describe('useJoinRoomOffer', () => {
  beforeEach(() => {
    mocks.available = true;
    mocks.labEnabled = false;
    mocks.lockHolderOwnerId = 'room:doc-1:abc';
    mocks.updateLab.mockReset();
  });

  it('offers to turn on the lab when the lock holder edits in the room', () => {
    const result = offer();

    result?.turnOn();

    expect(result?.reloadOtherTab).toBe(false);
    expect(mocks.updateLab).toHaveBeenCalledWith({ enablePageCollab: true });
  });

  it('offers nothing when another member edits outside the room', () => {
    mocks.lockHolderOwnerId = 'page:doc-1:abc';

    expect(offer()).toBeUndefined();
  });

  it("needs no reload when the user's other tab is already in the room", () => {
    expect(offer(true)?.reloadOtherTab).toBe(false);
  });

  it("asks to reload the other tab when the user's other tab edits outside the room", () => {
    mocks.lockHolderOwnerId = 'page:doc-1:abc';

    expect(offer(true)?.reloadOtherTab).toBe(true);
  });

  it('offers nothing where the deployment runs no rooms', () => {
    mocks.available = false;

    expect(offer()).toBeUndefined();
    expect(offer(true)).toBeUndefined();
  });

  it('offers nothing once the lab is on', () => {
    mocks.labEnabled = true;

    expect(offer()).toBeUndefined();
    expect(offer(true)).toBeUndefined();
  });
});
