/**
 * @vitest-environment happy-dom
 */
import type { TaskTemplateConnectorReference } from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectorConnectionMarketAuthRequiredError,
  ConnectorConnectionPopupBlockedError,
  useConnectorConnection,
} from './useConnectorConnection';

const mocks = vi.hoisted(() => ({
  desktop: false,
  openExternalLink: vi.fn(),
  marketAuth: {
    isAuthenticated: false,
    signIn: vi.fn(),
  },
  toolState: {
    checkLobehubSkillStatus: vi.fn(),
    composioServers: [],
    createComposioConnection: vi.fn(),
    getLobehubSkillAuthorizeUrl: vi.fn(),
    lobehubSkillServers: [] as { identifier: string; status: string }[],
    refreshComposioConnectionStatus: vi.fn(),
  },
}));

vi.mock('@/const/version', () => ({
  get isDesktop() {
    return mocks.desktop;
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink: mocks.openExternalLink },
}));

vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  useMarketAuth: () => mocks.marketAuth,
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T>(selector: (state: typeof mocks.toolState) => T): T => selector(mocks.toolState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: () => ({ user: { id: 'user-id' } }),
  },
}));

const lobehubSpec: TaskTemplateConnectorReference = { identifier: 'linear', source: 'lobehub' };

describe('useConnectorConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.desktop = false;
    mocks.marketAuth.isAuthenticated = false;
    mocks.marketAuth.signIn.mockResolvedValue(null);
    mocks.toolState.composioServers = [];
    mocks.toolState.lobehubSkillServers = [];
    mocks.toolState.getLobehubSkillAuthorizeUrl.mockResolvedValue({
      authorizeUrl: 'https://market.example.com/oauth/authorize',
      code: 'code',
      expiresIn: 600,
    });
    vi.spyOn(window, 'open').mockReturnValue({
      close: vi.fn(),
      closed: false,
    } as unknown as Window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('asks the user to sign in to Market before requesting LobeHub connector OAuth', async () => {
    const { result } = renderHook(() => useConnectorConnection([lobehubSpec]));

    let error: unknown;
    await act(async () => {
      try {
        await result.current.connect();
      } catch (caughtError) {
        error = caughtError;
      }
    });

    expect(error).toBeInstanceOf(ConnectorConnectionMarketAuthRequiredError);
    expect(mocks.marketAuth.signIn).toHaveBeenCalledWith('connector');
    expect(mocks.toolState.getLobehubSkillAuthorizeUrl).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens provider OAuth directly when Market is authenticated', async () => {
    mocks.marketAuth.isAuthenticated = true;
    const { result, unmount } = renderHook(() => useConnectorConnection([lobehubSpec]));

    await act(async () => {
      await result.current.connect();
    });

    expect(mocks.marketAuth.signIn).not.toHaveBeenCalled();
    expect(mocks.toolState.getLobehubSkillAuthorizeUrl).toHaveBeenCalledWith('linear', {
      redirectUri: expect.stringContaining('/oauth/callback/success?provider=linear'),
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://market.example.com/oauth/authorize',
      '_blank',
      'width=600,height=700',
    );

    unmount();
  });

  it('observes first-time GitHub authorization in the system browser without reopening the modal', async () => {
    vi.useFakeTimers();
    mocks.desktop = true;
    mocks.marketAuth.isAuthenticated = true;
    vi.mocked(window.open).mockReturnValue(null);
    const github: TaskTemplateConnectorReference = { identifier: 'github', source: 'lobehub' };
    const { result, rerender } = renderHook(() => useConnectorConnection([github]));

    await act(() => result.current.connect());

    expect(mocks.openExternalLink).toHaveBeenCalledWith(
      'https://market.example.com/oauth/authorize',
    );
    expect(mocks.toolState.getLobehubSkillAuthorizeUrl).toHaveBeenCalledWith('github', {
      redirectUri: undefined,
    });
    expect(result.current.isConnecting).toBe(true);
    // First-time consent may take longer than the web fallback polling window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.isConnecting).toBe(true);
    mocks.toolState.checkLobehubSkillStatus.mockImplementationOnce(async () => {
      mocks.toolState.lobehubSkillServers = [{ identifier: 'github', status: 'connected' }];
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    rerender();
    expect(result.current.isAllConnected).toBe(true);
    expect(result.current.isConnecting).toBe(false);

    mocks.toolState.checkLobehubSkillStatus.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.toolState.checkLobehubSkillStatus).not.toHaveBeenCalled();
  });

  it('releases an abandoned desktop authorization for retry and stops checking on unmount', async () => {
    vi.useFakeTimers();
    mocks.desktop = true;
    mocks.marketAuth.isAuthenticated = true;
    const { result, unmount } = renderHook(() => useConnectorConnection([lobehubSpec]));

    await act(() => result.current.connect());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(result.current.isConnecting).toBe(false);
    await act(() => result.current.connect());
    expect(mocks.openExternalLink).toHaveBeenCalledTimes(2);

    unmount();
    mocks.toolState.checkLobehubSkillStatus.mockClear();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.toolState.checkLobehubSkillStatus).not.toHaveBeenCalled();
  });

  it('reports a blocked popup on web', async () => {
    mocks.marketAuth.isAuthenticated = true;
    vi.mocked(window.open).mockReturnValue(null);
    const { result } = renderHook(() => useConnectorConnection([lobehubSpec]));

    await act(async () => {
      await expect(result.current.connect()).rejects.toBeInstanceOf(
        ConnectorConnectionPopupBlockedError,
      );
    });
    expect(result.current.isConnecting).toBe(false);
    expect(mocks.openExternalLink).not.toHaveBeenCalled();
  });

  it('turns Market 401 from the authorize URL request into a silent auth interruption', async () => {
    mocks.marketAuth.isAuthenticated = true;
    mocks.toolState.getLobehubSkillAuthorizeUrl.mockRejectedValue({
      data: { code: 'UNAUTHORIZED', httpStatus: 401 },
    });
    const { result } = renderHook(() => useConnectorConnection([lobehubSpec]));

    let error: unknown;
    await act(async () => {
      try {
        await result.current.connect();
      } catch (caughtError) {
        error = caughtError;
      }
    });

    expect(error).toBeInstanceOf(ConnectorConnectionMarketAuthRequiredError);
    expect(window.open).not.toHaveBeenCalled();
  });
});
