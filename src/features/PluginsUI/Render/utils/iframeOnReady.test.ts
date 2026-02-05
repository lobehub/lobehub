import { PluginChannel } from '@lobehub/chat-plugin-sdk/client';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOnPluginReadyForInteraction } from './iframeOnReady';

describe('useOnPluginReadyForInteraction', () => {
  const mockOnReady = vi.fn();

  afterEach(() => {
    mockOnReady.mockReset();
    window.removeEventListener('message', () => {});
  });

  it('sets readyForRender to true when a PluginChannel.pluginReadyForRender message is received', async () => {
    const { result } = renderHook(() => useOnPluginReadyForInteraction(mockOnReady));

    expect(result.current).toBe(false); // Initially, readyForRender should be false

    const event = new MessageEvent('message', {
      data: { type: PluginChannel.pluginReadyForRender },
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(result.current).toBe(true); // After the event, readyForRender should be true
  });

  it('sets readyForRender to true when a PluginChannel.pluginReadyForRender message is received', async () => {
    const { result } = renderHook(() => useOnPluginReadyForInteraction(mockOnReady));

    expect(result.current).toBe(false); // Initially, readyForRender should be false

    const event = new MessageEvent('message', {
      data: { type: PluginChannel.pluginReadyForRender },
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(result.current).toBe(true); // After the event, readyForRender should be true
    expect(mockOnReady).toHaveBeenCalledTimes(1); // onReady should have been called once
  });

  it('does not call onReady for non-pluginReadyForRender messages', async () => {
    renderHook(() => useOnPluginReadyForInteraction(mockOnReady));

    const event = new MessageEvent('message', {
      data: { type: 'nonPluginReadyMessage' },
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockOnReady).not.toHaveBeenCalled();
  });

  it('cleans up message event listener on unmount', () => {
    const { unmount } = renderHook(() => useOnPluginReadyForInteraction(mockOnReady));

    unmount();

    const event = new MessageEvent('message', {
      data: { type: PluginChannel.pluginReadyForRender },
    });

    window.dispatchEvent(event);

    expect(mockOnReady).not.toHaveBeenCalled();
  });
});
