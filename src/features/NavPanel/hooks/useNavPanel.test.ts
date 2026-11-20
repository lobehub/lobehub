import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGlobalStore } from '@/store/global';

import { useNavPanelSizeChangeHandler } from './useNavPanel';

describe('useNavPanelSizeChangeHandler', () => {
  beforeEach(() => {
    useGlobalStore.setState({ isNavPanelResizing: false, isStatusInit: true });
  });

  it('flags the nav panel as resizing until the pointer is released', () => {
    const { result } = renderHook(() => useNavPanelSizeChangeHandler());

    act(() => result.current?.({ width: 10 }, { width: 300 }));
    expect(useGlobalStore.getState().isNavPanelResizing).toBe(true);
    expect(useGlobalStore.getState().status.leftPanelWidth).toBe(300);

    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(useGlobalStore.getState().isNavPanelResizing).toBe(false);
  });

  it('clears the flag when the pointer is cancelled', () => {
    const { result } = renderHook(() => useNavPanelSizeChangeHandler());

    act(() => result.current?.({ width: 10 }, { width: 310 }));
    act(() => {
      window.dispatchEvent(new Event('pointercancel'));
    });

    expect(useGlobalStore.getState().isNavPanelResizing).toBe(false);
  });
});
