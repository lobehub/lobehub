import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposioServerStatus } from '@/store/tool/slices/composioStore';

import { ComposioOAuthPopupBlockedError, useComposioOAuth } from './useComposioOAuth';

const mockToolState = vi.hoisted(() => ({
  refreshComposioConnectionStatus: vi.fn(),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T,>(selector: (state: typeof mockToolState) => T) => selector(mockToolState),
}));

describe('useComposioOAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws a popup-blocked error when a blank popup cannot be opened', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    const { result } = renderHook(() => useComposioOAuth({}));

    expect(() => result.current.prepareOAuthWindow('gmail')).toThrow(ComposioOAuthPopupBlockedError);
    expect(result.current.isWaitingAuth).toBe(false);
  });

  it('reuses a pre-opened popup and navigates it to the OAuth URL', () => {
    const popup = {
      close: vi.fn(),
      closed: false,
      location: { href: 'about:blank' },
    } as unknown as Window;

    vi.spyOn(window, 'open').mockReturnValue(popup);

    const { result, unmount } = renderHook(() => useComposioOAuth({}));

    act(() => {
      result.current.prepareOAuthWindow('gmail');
      result.current.openOAuthWindow('https://example.com/oauth', 'gmail', popup);
    });

    expect(popup.location.href).toBe('https://example.com/oauth');
    expect(result.current.isWaitingAuth).toBe(true);

    unmount();
  });

  it('cancels the popup when the connection becomes active', () => {
    const popup = {
      close: vi.fn(),
      closed: false,
      location: { href: 'about:blank' },
    } as unknown as Window;

    vi.spyOn(window, 'open').mockReturnValue(popup);

    const { result, rerender } = renderHook(
      ({ serverStatus }) => useComposioOAuth({ serverStatus }),
      {
        initialProps: { serverStatus: undefined as ComposioServerStatus | undefined },
      },
    );

    act(() => {
      result.current.prepareOAuthWindow('gmail');
    });

    rerender({ serverStatus: ComposioServerStatus.ACTIVE });

    expect(result.current.isWaitingAuth).toBe(false);
  });
});
