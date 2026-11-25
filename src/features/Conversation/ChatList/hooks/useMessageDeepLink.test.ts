/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { highlightMessageWhenScrollSettles } from '@/features/Portal/TopicComments/messageLocator';

import { parseMessageIdFromHash, useMessageDeepLink } from './useMessageDeepLink';

vi.mock('@/features/Portal/TopicComments/messageLocator', () => ({
  highlightMessageWhenScrollSettles: vi.fn(),
}));

const renderDeepLink = (url: string) => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [url] }, children);
  return renderHook(() => ({ deepLink: useMessageDeepLink(), location: useLocation() }), {
    wrapper,
  });
};

describe('parseMessageIdFromHash', () => {
  it('parses and decodes a message id', () => {
    expect(parseMessageIdFromHash('#msg_%E4%B8%AD')).toBe('msg_中');
  });

  it('returns undefined for an empty hash', () => {
    expect(parseMessageIdFromHash('')).toBeUndefined();
  });

  it('keeps a malformed encoded id usable', () => {
    expect(parseMessageIdFromHash('#msg_%')).toBe('msg_%');
  });
});

describe('useMessageDeepLink', () => {
  it('hands a ?locate= target to the list instead of scrolling it from outside', () => {
    const { result } = renderDeepLink('/agent/agt_1/tpc_1?locate=msg_20&foo=1');

    expect(result.current.deepLink).toMatchObject({ id: 'msg_20', settleOnOwningRow: true });

    act(() => result.current.deepLink?.onHandled?.({ displayMessageId: 'msg_20', id: 'msg_20' }));

    expect(highlightMessageWhenScrollSettles).toHaveBeenCalledWith('msg_20');
    expect(result.current.location.search).toBe('?foo=1');
    expect(result.current.deepLink).toBeUndefined();
  });

  it('flashes the owning row when the located message has no element of its own', () => {
    const { result } = renderDeepLink('/agent/agt_1/tpc_1?locate=msg_tool');

    act(() =>
      result.current.deepLink?.onHandled?.({ displayMessageId: 'msg_group', id: 'msg_tool' }),
    );

    expect(highlightMessageWhenScrollSettles).toHaveBeenLastCalledWith('msg_group');
  });

  it('consumes a hash target without flashing it', () => {
    vi.mocked(highlightMessageWhenScrollSettles).mockClear();
    const { result } = renderDeepLink('/agent/agt_1/tpc_1?foo=1#msg_%E4%B8%AD');

    expect(result.current.deepLink).toMatchObject({ id: 'msg_中', settleOnOwningRow: false });

    act(() => result.current.deepLink?.onHandled?.({ displayMessageId: 'msg_中', id: 'msg_中' }));

    expect(highlightMessageWhenScrollSettles).not.toHaveBeenCalled();
    expect(result.current.location.hash).toBe('');
    expect(result.current.location.search).toBe('?foo=1');
  });
});
