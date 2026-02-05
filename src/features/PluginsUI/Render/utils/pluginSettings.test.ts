import { PluginChannel } from '@lobehub/chat-plugin-sdk/client';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOnPluginSettingsUpdate } from './pluginSettings';

describe('useOnPluginSettingsUpdate', () => {
  const mockCallback = vi.fn();

  afterEach(() => {
    mockCallback.mockReset();
    window.removeEventListener('message', () => {});
  });

  it('calls the callback when a PluginChannel updatePluginSettings message is received', () => {
    renderHook(() => useOnPluginSettingsUpdate(mockCallback));

    const testSettings = { theme: 'dark', notifications: true };
    const event = new MessageEvent('message', {
      data: { type: PluginChannel.updatePluginSettings, value: testSettings },
    });

    window.dispatchEvent(event);

    expect(mockCallback).toHaveBeenCalledWith(testSettings);
  });

  it('does not call the callback for non-updatePluginSettings messages', () => {
    renderHook(() => useOnPluginSettingsUpdate(mockCallback));

    const event = new MessageEvent('message', {
      data: { type: 'nonPluginSettingsUpdate', value: { irrelevant: true } },
    });

    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('cleans up message event listener on unmount', () => {
    const { unmount } = renderHook(() => useOnPluginSettingsUpdate(mockCallback));

    unmount();

    const event = new MessageEvent('message', {
      data: { type: PluginChannel.updatePluginSettings, value: {} },
    });

    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
  });
});
