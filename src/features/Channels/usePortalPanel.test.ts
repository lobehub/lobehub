/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { channelBrowserSessionId, usePortalPanel } from './usePortalPanel';

const acceptanceView = { acceptanceId: 'acc_1', type: PortalViewType.Acceptance } as const;

describe('usePortalPanel', () => {
  beforeEach(() => {
    act(() => useChatStore.setState({ portalStack: [], showPortal: false }));
  });

  it('opens when a link pushes an acceptance onto the portal stack', () => {
    const { result } = renderHook(() => usePortalPanel('chn_1'));
    expect(result.current.open).toBe(false);

    act(() => useChatStore.getState().openAcceptance('acc_1'));

    expect(result.current.open).toBe(true);
  });

  it('does not reopen a report left on the portal stack by another page', () => {
    act(() => useChatStore.setState({ portalStack: [acceptanceView], showPortal: true }));

    const { result } = renderHook(() => usePortalPanel('chn_1'));

    expect(result.current.open).toBe(false);
  });

  it('closes the report when moving to another Channel', () => {
    const { result, rerender } = renderHook(({ id }) => usePortalPanel(id), {
      initialProps: { id: 'chn_1' },
    });
    act(() => useChatStore.getState().openAcceptance('acc_1'));

    rerender({ id: 'chn_2' });

    expect(result.current.open).toBe(false);
  });

  it('leaves no report behind after leaving the Channel page', () => {
    const { unmount } = renderHook(() => usePortalPanel('chn_1'));
    act(() => useChatStore.getState().openAcceptance('acc_1'));

    unmount();

    expect(useChatStore.getState().portalStack).toEqual([]);
  });

  it('opens a link in the Channel side browser, apart from agent topics', () => {
    const { result } = renderHook(() => usePortalPanel('chn_1'));

    act(() =>
      useChatStore.getState().openBrowser(channelBrowserSessionId('chn_1'), 'https://example.com'),
    );

    expect(result.current.open).toBe(true);
    expect(useChatStore.getState().portalStack).toEqual([
      {
        request: { nonce: expect.any(Number), url: 'https://example.com' },
        sessionId: 'channel:chn_1',
        type: PortalViewType.Browser,
      },
    ]);
  });
});
