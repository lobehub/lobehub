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
    ({ appearance, doc }: { appearance: 'dark' | 'light'; doc: string }) =>
      useWidgetHtmlBridge({ current: frame }, doc, output, appearance),
    { initialProps: { appearance: 'dark', doc: '<p>v1</p>' } },
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
const document_ = (html: string) => [{ html, source: 'lobe-widget-host', type: 'document' }, '*'];

describe('useWidgetHtmlBridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('sends the content document when the wrapper is ready, and again when it changes', () => {
    const { fromFrame, hook, post } = setup();
    expect(post).not.toHaveBeenCalledWith(...document_('<p>v1</p>'));

    fromFrame({ source: 'lobe-widget-frame', type: 'wrapper-ready' });
    expect(post).toHaveBeenCalledWith(...document_('<p>v1</p>'));

    hook.rerender({ appearance: 'dark', doc: '<p>v2</p>' });
    expect(post).toHaveBeenLastCalledWith(...document_('<p>v2</p>'));
  });

  it('sends the output and theme when the content reports ready', () => {
    const { fromFrame, post } = setup();
    post.mockClear();
    fromFrame({ source: 'lobe-widget-frame', type: 'ready' });
    expect(post).toHaveBeenCalledWith(...update('dark'));
  });

  it('sends the new theme when it changes', () => {
    const { hook, post } = setup();
    hook.rerender({ appearance: 'light', doc: '<p>v1</p>' });
    expect(post).toHaveBeenLastCalledWith(...update('light'));
  });

  it('stops posting for good once the content tried to navigate away', () => {
    const { fromFrame, hook, post } = setup();
    expect(hook.result.current.blocked).toBe(false);

    fromFrame({ source: 'lobe-widget-frame', type: 'navigated' });
    expect(hook.result.current.blocked).toBe(true);

    post.mockClear();
    fromFrame({ source: 'lobe-widget-frame', type: 'ready' });
    fromFrame({ source: 'lobe-widget-frame', type: 'wrapper-ready' });
    hook.rerender({ appearance: 'light', doc: '<p>v2</p>' });
    expect(post).not.toHaveBeenCalled();
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
