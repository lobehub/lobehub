import type { WidgetOutput } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWidgetHtmlBridge } from './useWidgetHtmlBridge';

const output: WidgetOutput = { data: { ready: 3 }, type: 'data' };

const setup = () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const hook = renderHook(
    ({ appearance }: { appearance: 'dark' | 'light' }) =>
      useWidgetHtmlBridge({ current: frame }, output, appearance),
    { initialProps: { appearance: 'dark' } },
  );
  const fromFrame = (data: unknown, source: MessageEventSource | null = frame.contentWindow) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source }));
    });
  return { fromFrame, hook, post };
};

const update = (appearance: 'dark' | 'light') => [
  { output, source: 'lobe-widget-host', theme: { appearance }, type: 'update' },
  '*',
];

describe('useWidgetHtmlBridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('sends the output and theme again when the frame reports ready', () => {
    const { fromFrame, post } = setup();
    post.mockClear();
    fromFrame({ source: 'lobe-widget-frame', type: 'ready' });
    expect(post).toHaveBeenCalledWith(...update('dark'));
  });

  it('sends the new theme when it changes', () => {
    const { hook, post } = setup();
    hook.rerender({ appearance: 'light' });
    expect(post).toHaveBeenLastCalledWith(...update('light'));
  });

  it('opens only web links, and only from its own frame', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { fromFrame } = setup();

    fromFrame({ source: 'lobe-widget-frame', type: 'open', url: 'javascript:alert(1)' });
    fromFrame({ source: 'lobe-widget-frame', type: 'open', url: 'https://a.com' }, window);
    expect(open).not.toHaveBeenCalled();

    fromFrame({ source: 'lobe-widget-frame', type: 'open', url: 'https://github.com' });
    expect(open).toHaveBeenCalledWith('https://github.com', '_blank', 'noopener,noreferrer');
  });
});
