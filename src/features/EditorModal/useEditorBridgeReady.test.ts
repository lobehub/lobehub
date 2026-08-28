import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EditorBridge } from './type';
import { useEditorBridgeReady } from './useEditorBridgeReady';

describe('useEditorBridgeReady', () => {
  it('reports not ready while the lazy content has not produced an editor', () => {
    // Regression: the footer stayed interactive during the content chunk load,
    // so a quick Save read a missing editor, fell back to '' and overwrote the
    // caller's value.
    const bridge: EditorBridge = {};
    const { result } = renderHook(() => useEditorBridgeReady(bridge));

    expect(result.current).toBe(false);
  });

  it('flips to ready when the content notifies', () => {
    const bridge: EditorBridge = {};
    const { result } = renderHook(() => useEditorBridgeReady(bridge));

    act(() => {
      bridge.current = {} as EditorBridge['current'];
      bridge.notifyReady?.();
    });

    expect(result.current).toBe(true);
  });

  it('is ready immediately when the editor already exists', () => {
    const bridge: EditorBridge = { current: {} as EditorBridge['current'] };
    const { result } = renderHook(() => useEditorBridgeReady(bridge));

    expect(result.current).toBe(true);
  });

  it('detaches its notifier on unmount so a stale footer cannot be revived', () => {
    const bridge: EditorBridge = {};
    const { unmount } = renderHook(() => useEditorBridgeReady(bridge));

    expect(typeof bridge.notifyReady).toBe('function');
    unmount();
    expect(bridge.notifyReady).toBeUndefined();
  });
});
