import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposioServerStatus } from '@/store/tool/slices/composioStore';

import { ComposioOAuthPopupBlockedError } from './useComposioOAuth';
import { useComposioServerActions } from './useComposioServerActions';

const mockToolState = vi.hoisted(() => ({
  createComposioConnection: vi.fn(),
  reauthorizeComposioConnection: vi.fn(),
  refreshComposioConnectionStatus: vi.fn(),
}));

const mockUserState = vi.hoisted(() => ({
  toggleInboxAgentDefaultPlugin: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T,>(selector: (state: typeof mockToolState) => T) => selector(mockToolState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: <T,>(selector: (state: typeof mockUserState) => T) => selector(mockUserState),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: mockToast,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        {
          'proSettings.connectors.connectFailed': 'Could not start the connection. Please try again.',
          'proSettings.connectors.popupBlocked':
            'Connection popup blocked. Allow popups in your browser to continue.',
        } as Record<string, string>
      )[key] || key,
  }),
}));

describe('useComposioServerActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a connect error when createComposioConnection returns nothing', async () => {
    mockToolState.createComposioConnection.mockResolvedValue(undefined);

    const onCancelAuth = vi.fn();
    const onBeforeAuth = vi.fn(() => null);

    const { result } = renderHook(() =>
      useComposioServerActions({
        appSlug: 'gmail',
        identifier: 'gmail',
        label: 'Gmail',
        onBeforeAuth,
        onCancelAuth,
      }),
    );

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(onBeforeAuth).toHaveBeenCalledWith('gmail');
    expect(onCancelAuth).toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      'Could not start the connection. Please try again.',
    );
  });

  it('opens OAuth before pinning the default plugin', async () => {
    mockToolState.createComposioConnection.mockResolvedValue({
      identifier: 'gmail',
      redirectUrl: 'https://example.com/oauth',
      status: ComposioServerStatus.PENDING_AUTH,
    });

    const order: string[] = [];
    const oauthWindow = {} as Window;
    const onBeforeAuth = vi.fn(() => {
      order.push('prepare');
      return oauthWindow;
    });
    const onAuthRequired = vi.fn(() => {
      order.push('auth');
    });
    mockUserState.toggleInboxAgentDefaultPlugin.mockImplementation(async () => {
      order.push('pin');
    });

    const { result } = renderHook(() =>
      useComposioServerActions({
        appSlug: 'gmail',
        identifier: 'gmail',
        label: 'Gmail',
        onAuthRequired,
        onBeforeAuth,
      }),
    );

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(onAuthRequired).toHaveBeenCalledWith(
      'https://example.com/oauth',
      'gmail',
      oauthWindow,
    );
    expect(order).toEqual(['prepare', 'auth', 'pin']);
  });

  it('shows a popup-blocked message when pre-opening the popup fails', async () => {
    const { result } = renderHook(() =>
      useComposioServerActions({
        appSlug: 'gmail',
        identifier: 'gmail',
        label: 'Gmail',
        onBeforeAuth: () => {
          throw new ComposioOAuthPopupBlockedError();
        },
      }),
    );

    await act(async () => {
      await result.current.handleConnect();
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      'Connection popup blocked. Allow popups in your browser to continue.',
    );
    expect(mockToolState.createComposioConnection).not.toHaveBeenCalled();
  });

  it('shows a connect error when reauthorization has no fresh OAuth URL', async () => {
    mockToolState.reauthorizeComposioConnection.mockResolvedValue({
      identifier: 'gmail',
      redirectUrl: undefined,
      status: ComposioServerStatus.PENDING_AUTH,
    });

    const onCancelAuth = vi.fn();

    const { result } = renderHook(() =>
      useComposioServerActions({
        appSlug: 'gmail',
        identifier: 'gmail',
        label: 'Gmail',
        onCancelAuth,
        server: {
          identifier: 'gmail',
          status: ComposioServerStatus.PENDING_AUTH,
        } as any,
      }),
    );

    await act(async () => {
      await result.current.handleReauthorize();
    });

    expect(onCancelAuth).toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      'Could not start the connection. Please try again.',
    );
  });
});
