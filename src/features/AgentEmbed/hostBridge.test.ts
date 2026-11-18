import { wrapEmbedMessage } from '@lobechat/embed/protocol';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEmbedForcedTheme } from '@/libs/agentEmbed/forcedTheme';

import { startEmbedHostBridge } from './hostBridge';

const HOST = 'https://docs.example.com';

const createFramedWindow = (search = '') => {
  const listeners = new Set<(event: MessageEvent) => void>();
  const parent = { postMessage: vi.fn() };
  const win = {
    addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.add(listener),
    location: { search },
    parent,
    removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.delete(listener),
  } as unknown as Window;
  const dispatch = (data: unknown, init: { origin: string; source: unknown }) =>
    act(() => {
      for (const listener of listeners) listener({ data, ...init } as MessageEvent);
    });

  return { dispatch, parent, win };
};

describe('startEmbedHostBridge', () => {
  it('learns the host from init, answers ready to that origin only and applies its theme', () => {
    const { dispatch, parent, win } = createFramedWindow('?theme=light');
    const bridge = startEmbedHostBridge(win);
    const { result } = renderHook(() => useEmbedForcedTheme());
    expect(result.current).toBe('light');

    bridge.emit({ type: 'messageSent' });
    expect(parent.postMessage).not.toHaveBeenCalled();

    dispatch(wrapEmbedMessage({ theme: 'dark', type: 'init' }), { origin: HOST, source: parent });
    expect(parent.postMessage).toHaveBeenCalledWith(wrapEmbedMessage({ type: 'ready' }), HOST);

    bridge.emit({ topicId: 'tpc_1', type: 'topicCreated' });
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      wrapEmbedMessage({ topicId: 'tpc_1', type: 'topicCreated' }),
      HOST,
    );
    bridge.stop();
  });

  it('ignores messages from anything but the parent, and a second origin after init', () => {
    const { dispatch, parent, win } = createFramedWindow();
    const bridge = startEmbedHostBridge(win);
    const { result } = renderHook(() => useEmbedForcedTheme());

    dispatch(wrapEmbedMessage({ theme: 'dark', type: 'init' }), { origin: HOST, source: {} });
    expect(parent.postMessage).not.toHaveBeenCalled();

    dispatch(wrapEmbedMessage({ type: 'init' }), { origin: HOST, source: parent });
    dispatch(wrapEmbedMessage({ theme: 'dark', type: 'setTheme' }), {
      origin: 'https://evil.example',
      source: parent,
    });
    dispatch(wrapEmbedMessage({ theme: 'dark', type: 'init' }), {
      origin: 'https://evil.example',
      source: parent,
    });
    expect(result.current).not.toBe('dark');
    expect(parent.postMessage).toHaveBeenCalledTimes(1);

    dispatch(wrapEmbedMessage({ theme: 'dark', type: 'setTheme' }), {
      origin: HOST,
      source: parent,
    });
    expect(result.current).toBe('dark');
    bridge.stop();
  });

  it('stays silent when the page is not framed', () => {
    const { win } = createFramedWindow();
    (win as { parent: unknown }).parent = win;
    const bridge = startEmbedHostBridge(win);

    expect(bridge.framed).toBe(false);
    bridge.stop();
  });
});
