import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ComposioServer, ComposioServerStatus } from '@/store/tool/slices/composioStore';

import { useConnectAppToggle } from './useConnectAppToggle';

const mocks = vi.hoisted(() => ({
  createComposioConnection: vi.fn(),
  reauthorizeComposioConnection: vi.fn(),
  refreshComposioConnectionStatus: vi.fn().mockResolvedValue(undefined),
  removeComposioConnection: vi.fn().mockResolvedValue(undefined),
  state: {
    composioServers: [] as ComposioServer[],
  },
  toggleInboxAgentDefaultPlugin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      composioServers: mocks.state.composioServers,
      createComposioConnection: mocks.createComposioConnection,
      reauthorizeComposioConnection: mocks.reauthorizeComposioConnection,
      refreshComposioConnectionStatus: mocks.refreshComposioConnectionStatus,
      removeComposioConnection: mocks.removeComposioConnection,
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ toggleInboxAgentDefaultPlugin: mocks.toggleInboxAgentDefaultPlugin }),
}));

const APP_PROPS = { appSlug: 'GMAIL', identifier: 'gmail', label: 'Gmail' };

beforeEach(() => {
  mocks.state.composioServers = [];
  mocks.createComposioConnection.mockReset();
  mocks.reauthorizeComposioConnection.mockReset();
  mocks.refreshComposioConnectionStatus.mockClear().mockResolvedValue(undefined);
  mocks.removeComposioConnection.mockClear().mockResolvedValue(undefined);
  mocks.toggleInboxAgentDefaultPlugin.mockClear().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useConnectAppToggle', () => {
  it('starts disconnected and not loading when no server exists', () => {
    const { result } = renderHook(() => useConnectAppToggle(APP_PROPS));

    expect(result.current.checked).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('goes pending then settles connected on OAuth success', async () => {
    mocks.createComposioConnection.mockResolvedValue({
      appSlug: 'GMAIL',
      authConfigId: 'auth',
      connectedAccountId: 'acc',
      createdAt: 0,
      identifier: 'gmail',
      label: 'Gmail',
      redirectUrl: 'https://composio.dev/oauth',
      status: ComposioServerStatus.PENDING_AUTH,
    });
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );

    const { result, rerender } = renderHook(() => useConnectAppToggle(APP_PROPS));

    await act(async () => {
      await result.current.onToggle(true);
    });

    expect(mocks.createComposioConnection).toHaveBeenCalledWith({
      appSlug: 'GMAIL',
      identifier: 'gmail',
      label: 'Gmail',
    });
    expect(result.current.checked).toBe(false);
    expect(result.current.loading).toBe(true);

    mocks.state.composioServers = [
      {
        appSlug: 'GMAIL',
        authConfigId: 'auth',
        connectedAccountId: 'acc',
        createdAt: 0,
        identifier: 'gmail',
        label: 'Gmail',
        status: ComposioServerStatus.ACTIVE,
      },
    ];
    rerender();

    expect(result.current.checked).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('reverts to off when the popup closes without completing auth', async () => {
    vi.useFakeTimers();
    mocks.createComposioConnection.mockResolvedValue({
      appSlug: 'GMAIL',
      authConfigId: 'auth',
      connectedAccountId: 'acc',
      createdAt: 0,
      identifier: 'gmail',
      label: 'Gmail',
      redirectUrl: 'https://composio.dev/oauth',
      status: ComposioServerStatus.PENDING_AUTH,
    });
    vi.stubGlobal(
      'open',
      vi.fn(() => ({ closed: true }) as unknown as Window),
    );

    const { result } = renderHook(() => useConnectAppToggle(APP_PROPS));

    await act(async () => {
      await result.current.onToggle(true);
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.checked).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('disconnects a connected app', async () => {
    mocks.state.composioServers = [
      {
        appSlug: 'GMAIL',
        authConfigId: 'auth',
        connectedAccountId: 'acc',
        createdAt: 0,
        identifier: 'gmail',
        label: 'Gmail',
        status: ComposioServerStatus.ACTIVE,
      },
    ];

    const { result, rerender } = renderHook(() => useConnectAppToggle(APP_PROPS));

    expect(result.current.checked).toBe(true);

    await act(async () => {
      await result.current.onToggle(false);
    });

    expect(mocks.removeComposioConnection).toHaveBeenCalledWith('gmail');

    mocks.state.composioServers = [];
    rerender();

    expect(result.current.checked).toBe(false);
    expect(result.current.loading).toBe(false);
  });
});
