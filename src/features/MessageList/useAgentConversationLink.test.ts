/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentConversationLink, useInboxConversationLink } from './useAgentConversationLink';

const state = vi.hoisted(() => ({
  directChannelId: undefined as string | undefined,
  enabled: true,
  inboxAgentId: 'agt_inbox' as string | undefined,
  navigate: vi.fn(),
  openDirect: vi.fn(),
  pathname: '/',
  scope: 'personal',
  slug: null as string | null,
}));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: state.pathname, search: '' }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => state.slug,
}));
vi.mock('@/libs/replica', () => ({ cacheScope: { get: () => state.scope } }));

vi.mock('@/features/AgentRoute/useResolvedAgentRouteId', () => ({
  resolveInboxAgentRouteId: (id?: string) => id ?? 'inbox',
}));
vi.mock('@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl', () => ({
  usePreservedAgentUrl: (id: string) => `/agent/${id}`,
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { inboxAgentId: () => state.inboxAgentId },
}));
vi.mock('@/features/Channels/useChannelsEnabled', () => ({
  useChannelsEnabled: () => state.enabled,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => state.navigate,
}));
vi.mock('@/store/channel', () => ({
  channelActions: { openDirect: state.openDirect },
  channelSelectors: {
    directByAgent: () => () => (state.directChannelId ? { id: state.directChannelId } : undefined),
  },
  useChannelStore: (selector: (s: object) => unknown) => selector({}),
}));

const click = (patch: Partial<MouseEvent> = {}) =>
  ({ button: 0, preventDefault: vi.fn(), ...patch }) as unknown as MouseEvent<HTMLAnchorElement>;

const render = () => renderHook(() => useAgentConversationLink('agt_nasa', '/agent/agt_nasa'));

describe('useAgentConversationLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.directChannelId = undefined;
    state.enabled = true;
    state.inboxAgentId = 'agt_inbox';
    state.pathname = '/';
    state.scope = 'personal';
    state.slug = null;
  });

  it('links an Agent row to its direct Channel', () => {
    state.directChannelId = 'chn_000000000001';
    expect(render().result.current).toEqual({ url: '/channels/chn_000000000001' });
  });

  it('keeps the Agent page while the Agent id is still loading', () => {
    state.directChannelId = 'chn_000000000001';
    const { result } = renderHook(() => useAgentConversationLink(undefined, '/agent/inbox'));
    expect(result.current).toEqual({ onClick: undefined, url: '/agent/inbox' });
  });

  it('links the inbox Agent row to its direct Channel', () => {
    state.directChannelId = 'chn_000000000001';
    const { result } = renderHook(() => useInboxConversationLink());
    expect(result.current).toEqual({ url: '/channels/chn_000000000001' });
  });

  it('opens a missing inbox direct Channel on click', async () => {
    state.openDirect.mockResolvedValue('chn_000000000002');
    const { result } = renderHook(() => useInboxConversationLink());

    await act(async () => result.current.onClick?.(click()));

    expect(state.openDirect).toHaveBeenCalledWith('agt_inbox');
    expect(state.navigate).toHaveBeenCalledWith('/channels/chn_000000000002');
  });

  it('keeps the Agent page while Channels are off', () => {
    state.enabled = false;
    expect(render().result.current).toEqual({ onClick: undefined, url: '/agent/agt_nasa' });
  });

  it('opens a missing direct Channel on click and navigates into it', async () => {
    state.openDirect.mockResolvedValue('chn_000000000002');
    const { result } = render();
    const event = click();

    await act(async () => result.current.onClick?.(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(state.openDirect).toHaveBeenCalledExactlyOnceWith('agt_nasa');
    expect(state.navigate).toHaveBeenCalledWith('/channels/chn_000000000002');
  });

  it.each([
    ['cannot answer in a Channel', () => state.openDirect.mockResolvedValue(undefined)],
    ['fails to open one', () => state.openDirect.mockRejectedValue(new Error('offline'))],
  ])('falls back to the Agent page when the Agent %s', async (_, arrange) => {
    arrange();
    const { result } = render();

    await act(async () => result.current.onClick?.(click()));

    expect(state.navigate).toHaveBeenCalledWith('/agent/agt_nasa');
  });

  // A slow open pulled the person away from the conversation they picked meanwhile.
  it.each([
    [
      'another conversation is opened meanwhile',
      (rerender: () => void) => {
        state.pathname = '/channels/chn_000000000009';
        rerender();
      },
    ],
    [
      'the workspace changes meanwhile',
      () => {
        state.scope = 'workspace:other';
      },
    ],
  ])('does not navigate when %s', async (_, change) => {
    let resolve!: (id: string) => void;
    state.openDirect.mockReturnValue(new Promise<string>((r) => (resolve = r)));
    const { rerender, result } = render();

    act(() => result.current.onClick?.(click()));
    change(rerender);
    await act(async () => resolve('chn_000000000002'));

    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('leaves a modified click to the browser', () => {
    const { result } = render();
    const event = click({ metaKey: true });

    result.current.onClick?.(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.openDirect).not.toHaveBeenCalled();
  });
});
