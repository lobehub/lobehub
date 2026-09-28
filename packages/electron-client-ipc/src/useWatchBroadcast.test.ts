// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWatchBroadcast } from './useWatchBroadcast';

describe('useWatchBroadcast', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the disposer returned by the preload bridge', () => {
    const handler = vi.fn();
    const legacyRemoveListener = vi.fn();
    const unsubscribe = vi.fn();
    const on = vi.fn(
      (_event: string, _listener: (event: unknown, data: { locale: string }) => void) =>
        unsubscribe,
    );

    vi.stubGlobal('window', {
      electron: { ipcRenderer: { on, removeListener: legacyRemoveListener } },
    });

    const { unmount } = renderHook(() => useWatchBroadcast('localeChanged', handler));
    const listener = on.mock.calls[0]?.[1];

    listener?.(undefined, { locale: 'zh-CN' });
    expect(handler).toHaveBeenCalledWith({ locale: 'zh-CN' });

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(legacyRemoveListener).not.toHaveBeenCalled();
  });
});
