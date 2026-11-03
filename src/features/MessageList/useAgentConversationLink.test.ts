/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentConversationLink } from './useAgentConversationLink';

const state = vi.hoisted(() => ({
  directChannelId: undefined as string | undefined,
  enabled: true,
  navigate: vi.fn(),
  openDirect: vi.fn(),
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
  });

  it('links an Agent row to its direct Channel', () => {
    state.directChannelId = 'chn_000000000001';
    expect(render().result.current).toEqual({ url: '/channels/chn_000000000001' });
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

  it('leaves a modified click to the browser', () => {
    const { result } = render();
    const event = click({ metaKey: true });

    result.current.onClick?.(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.openDirect).not.toHaveBeenCalled();
  });
});
