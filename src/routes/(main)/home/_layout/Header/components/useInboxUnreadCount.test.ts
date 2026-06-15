import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inboxKeys } from '@/libs/swr/keys';

import { INBOX_UNREAD_COUNT_REFRESH_INTERVAL, useInboxUnreadCount } from './useInboxUnreadCount';

const mocks = vi.hoisted(() => ({
  state: {
    enableBusinessFeatures: true,
    isSignedIn: false,
  },
  useClientDataSWR: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: mocks.useClientDataSWR,
}));

vi.mock('@/services/notification', () => ({
  notificationService: {
    getUnreadCount: vi.fn(),
  },
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: (state: { serverConfig: { enableBusinessFeatures: boolean } }) =>
      state.serverConfig.enableBusinessFeatures,
  },
  useServerConfigStore: (
    selector: (state: { serverConfig: { enableBusinessFeatures: boolean } }) => boolean,
  ) => selector({ serverConfig: { enableBusinessFeatures: mocks.state.enableBusinessFeatures } }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { isSignedIn: boolean }) => boolean) =>
    selector({ isSignedIn: mocks.state.isSignedIn }),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    isLogin: (state: { isSignedIn: boolean }) => state.isSignedIn,
  },
}));

beforeEach(() => {
  mocks.state.enableBusinessFeatures = true;
  mocks.state.isSignedIn = false;
  mocks.useClientDataSWR.mockClear();
  mocks.useClientDataSWR.mockReturnValue({ data: undefined });
});

describe('useInboxUnreadCount', () => {
  it('does not request unread count before login', () => {
    const { result } = renderHook(() => useInboxUnreadCount());

    expect(result.current.enabled).toBe(false);
    expect(mocks.useClientDataSWR).toHaveBeenCalledWith(null, expect.any(Function), {
      refreshInterval: INBOX_UNREAD_COUNT_REFRESH_INTERVAL,
    });
  });

  it('requests unread count when business features are enabled and user is logged in', () => {
    mocks.state.isSignedIn = true;

    const { result } = renderHook(() => useInboxUnreadCount());

    expect(result.current.enabled).toBe(true);
    expect(mocks.useClientDataSWR).toHaveBeenCalledWith(
      inboxKeys.unreadCount(),
      expect.any(Function),
      {
        refreshInterval: INBOX_UNREAD_COUNT_REFRESH_INTERVAL,
      },
    );
  });

  it('keeps unread count polling on the same 10 second cadence', () => {
    expect(INBOX_UNREAD_COUNT_REFRESH_INTERVAL).toBe(10_000);
  });
});
