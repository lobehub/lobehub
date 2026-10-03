import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposioServerStatus } from '@/store/tool/slices/composioStore';

const refreshComposioConnectionStatus = vi.fn();

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: unknown) => unknown) =>
    selector({ refreshComposioConnectionStatus }),
}));

const { useComposioOAuth } = await import('./useComposioOAuth');

describe('useComposioOAuth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshComposioConnectionStatus.mockReset();
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
  });

  it('keeps polling long enough for delayed Composio activation', async () => {
    const { result } = renderHook(() =>
      useComposioOAuth({ serverStatus: ComposioServerStatus.PENDING_AUTH }),
    );
    const oauthWindow = { closed: false };
    vi.mocked(window.open).mockReturnValue(oauthWindow as Window);

    act(() => {
      result.current.openOAuthWindow('https://composio.test/oauth', 'gmail');
      vi.advanceTimersByTime(500);
    });

    oauthWindow.closed = true;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(refreshComposioConnectionStatus).toHaveBeenCalled();
    expect(result.current.isWaitingAuth).toBe(true);

    act(() => {
      vi.advanceTimersByTime(31_100);
    });

    expect(result.current.isWaitingAuth).toBe(false);
    vi.useRealTimers();
  });
});
