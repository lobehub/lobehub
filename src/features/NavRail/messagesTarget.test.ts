import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChannelStore } from '@/store/channel';

import { nextActiveChannelId, useMessagesUrl } from './messagesTarget';

describe('nextActiveChannelId', () => {
  it.each([
    [undefined, '/channels/chn_1', null, 'chn_1'],
    ['chn_1', '/lobe-team/channels/chn_2', 'lobe-team', 'chn_2'],
    // Other pages keep the active Channel.
    ['chn_1', '/agent/agt_1', null, 'chn_1'],
    ['chn_1', '/tasks', null, 'chn_1'],
    // A project's Channel belongs to the Projects tab.
    ['chn_1', '/project/project-1/channels/chn_9', null, 'chn_1'],
    // Home clears it.
    ['chn_1', '/', null, undefined],
    ['chn_1', '/lobe-team', 'lobe-team', undefined],
  ])('%s + %s → %s', (previous, pathname, slug, expected) => {
    expect(nextActiveChannelId(previous, pathname, slug)).toBe(expected);
  });
});

describe('useMessagesUrl', () => {
  beforeEach(() => {
    useChannelStore.setState({
      listMap: { all: [{ id: 'chn_1' }] as never },
    } as never);
  });

  it('opens home when no Channel is active', () => {
    const { result } = renderHook(() => useMessagesUrl('/agent/agt_1', null));
    expect(result.current.url).toBe('/');
  });

  it('returns to the last opened Channel after leaving it', () => {
    const { result, rerender } = renderHook(({ pathname }) => useMessagesUrl(pathname, null), {
      initialProps: { pathname: '/channels/chn_1' },
    });
    expect(result.current.url).toBe('/channels/chn_1');

    rerender({ pathname: '/agent/agt_1' });
    expect(result.current.url).toBe('/channels/chn_1');

    rerender({ pathname: '/' });
    expect(result.current.url).toBe('/');
  });

  it('falls back home once the Channel is gone', () => {
    const { result } = renderHook(() => useMessagesUrl('/channels/chn_1', null));
    act(() => {
      useChannelStore.setState({ listMap: { all: [] } } as never);
    });
    expect(result.current.url).toBe('/');
  });
});
