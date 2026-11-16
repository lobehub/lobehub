import type { DeviceListItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeviceVisibilityActions } from './useDeviceVisibilityActions';

const { confirmModal, mutateAsync } = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({ confirmModal }));
vi.mock('@/features/VisibilityConfirmContent', () => ({ default: () => null }));
vi.mock('./useDeviceCardMutations', () => ({
  useDeviceCardMutations: () => ({ setVisibility: { mutateAsync } }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { userId: () => 'user_a' } }));

const device = (patch: Partial<DeviceListItem> = {}) =>
  ({
    deviceId: 'dev_1',
    enroller: { avatar: null, fullName: null, userId: 'user_a', username: null },
    registered: true,
    scope: 'workspace',
    visibility: 'private',
    ...patch,
  }) as DeviceListItem;

afterEach(() => {
  vi.clearAllMocks();
});

describe('useDeviceVisibilityActions', () => {
  // The device page offers the same switch as the card menu, so Lobot's link lands on it.
  it('publishes the device once the enroller confirms', async () => {
    const { result } = renderHook(() => useDeviceVisibilityActions(device()));
    expect(result.current.canToggle).toBe(true);

    result.current.publish();
    expect(mutateAsync).not.toHaveBeenCalled();
    await confirmModal.mock.calls[0][0].onOk();
    expect(mutateAsync).toHaveBeenCalledWith({ deviceId: 'dev_1', visibility: 'public' });
  });

  it('makes the device private once the enroller confirms', async () => {
    const { result } = renderHook(() =>
      useDeviceVisibilityActions(device({ visibility: 'public' })),
    );

    result.current.makePrivate();
    await confirmModal.mock.calls[0][0].onOk();
    expect(mutateAsync).toHaveBeenCalledWith({ deviceId: 'dev_1', visibility: 'private' });
  });

  it('offers no switch to a member who did not enroll the device', () => {
    const { result } = renderHook(() =>
      useDeviceVisibilityActions(
        device({ enroller: { avatar: null, fullName: null, userId: 'user_b', username: null } }),
      ),
    );
    expect(result.current.canToggle).toBe(false);
  });
});
