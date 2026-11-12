/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveTopicDrawerPortalHostViewType } from '@/features/AgentTasks/hooks/useTopicDrawerArtifactPortal';
import { useChatStore } from '@/store/chat';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import {
  CHANNEL_ENTITY_PORTAL_SCOPE,
  channelBrowserSessionId,
  isChannelPortalView,
  usePortalPanel,
} from './usePortalPanel';

const acceptanceView = { acceptanceId: 'acc_1', type: PortalViewType.Acceptance } as const;

describe('isChannelPortalView', () => {
  it('hosts the details a Channel can show beside its feed', () => {
    expect(isChannelPortalView(PortalViewType.Acceptance)).toBe(true);
    expect(isChannelPortalView(PortalViewType.AgentDetail)).toBe(true);
    expect(isChannelPortalView(PortalViewType.TaskDetail)).toBe(true);
    expect(isChannelPortalView(PortalViewType.Browser)).toBe(true);
  });

  it('leaves a detail the Channel has no panel for to its own route', () => {
    expect(isChannelPortalView(PortalViewType.Goal)).toBe(false);
    expect(isChannelPortalView(null)).toBe(false);
  });
});

describe('channel portal host view', () => {
  it('keeps the panel on the task while its drawer hosts the generated artifact', () => {
    const hostView = resolveTopicDrawerPortalHostViewType({
      currentViewType: PortalViewType.Artifact,
      parentViewType: PortalViewType.TaskDetail,
      showArtifactPortal: true,
    });

    expect(hostView).toBe(PortalViewType.TaskDetail);
    expect(isChannelPortalView(hostView)).toBe(true);
  });

  it('leaves the panel to an artifact no drawer hosts', () => {
    const hostView = resolveTopicDrawerPortalHostViewType({
      currentViewType: PortalViewType.Artifact,
      parentViewType: PortalViewType.TaskDetail,
      showArtifactPortal: false,
    });

    expect(hostView).toBe(PortalViewType.Artifact);
    expect(isChannelPortalView(hostView)).toBe(false);
  });
});

describe('CHANNEL_ENTITY_PORTAL_SCOPE', () => {
  it('covers the entities a reply links without leaving the Channel', () => {
    expect(CHANNEL_ENTITY_PORTAL_SCOPE).toContain('acceptance');
    expect(CHANNEL_ENTITY_PORTAL_SCOPE).toContain('agent');
    expect(CHANNEL_ENTITY_PORTAL_SCOPE).toContain('task');
  });
});

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

  it('opens when a task link pushes a task detail onto the portal stack', () => {
    const { result } = renderHook(() => usePortalPanel('chn_1'));
    expect(result.current.open).toBe(false);

    act(() => useChatStore.getState().openTaskDetail('T-13987'));

    expect(result.current.open).toBe(true);
  });

  it('opens when an Agent link pushes the Agent detail onto the portal stack', () => {
    const { result } = renderHook(() => usePortalPanel('chn_1'));
    expect(result.current.open).toBe(false);

    act(() => useChatStore.getState().openAgentDetail('agt_1'));

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
