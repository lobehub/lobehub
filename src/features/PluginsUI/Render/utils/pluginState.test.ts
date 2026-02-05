import { PluginChannel } from '@lobehub/chat-plugin-sdk/client';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOnPluginStateUpdate } from './pluginState';

describe('useOnPluginStateUpdate', () => {
  // Mock for the callback function to be used in tests
  const mockCallback = vi.fn();

  afterEach(() => {
    // Reset the mock callback after each test
    mockCallback.mockReset();
    // Ensure no event listeners are left hanging after each test
    window.removeEventListener('message', () => {});
  });

  it('calls the callback when a PluginChannel update message is received', () => {
    renderHook(() => useOnPluginStateUpdate(mockCallback));

    const testKey = 'testKey';
    const testValue = 'testValue';
    const event = new MessageEvent('message', {
      data: { type: PluginChannel.updatePluginState, key: testKey, value: testValue },
    });

    window.dispatchEvent(event);

    expect(mockCallback).toHaveBeenCalledWith(testKey, testValue);
  });

  it('does not call the callback for non-PluginChannel messages', () => {
    renderHook(() => useOnPluginStateUpdate(mockCallback));

    const event = new MessageEvent('message', {
      data: { type: 'nonPluginMessage', key: 'key', value: 'value' },
    });

    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
  });
});
