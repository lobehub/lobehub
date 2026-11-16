import type { ChannelListItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useChannelStore } from '@/store/channel';
import { channelViewKey } from '@/store/channel/projection';

import ChannelDynamicMeta from './ChannelDynamicMeta';

vi.mock('@/features/RouteMeta/workspaceScope', () => ({
  matchesRouteWorkspace: () => true,
  useRouteWorkspaceId: () => null,
}));

const listItem = (patch: Partial<ChannelListItem>) =>
  ({
    agentId: null,
    id: 'chn_000000000001',
    projectId: null,
    title: 'Design',
    workspaceId: null,
    ...patch,
  }) as ChannelListItem;

const render = () => {
  const onResolve = vi.fn();
  renderHook(() => ChannelDynamicMeta({ onResolve, params: { channelId: 'chn_000000000001' } }));
  return onResolve;
};

describe('ChannelDynamicMeta', () => {
  beforeEach(() => {
    useAgentStore.setState({ agentMap: {} });
    useChannelStore.setState({ detailMap: {}, listMap: {} });
  });

  it('keeps the channel icon for a group channel', () => {
    useChannelStore.setState({ listMap: { all: [listItem({})] } });

    expect(render()).toHaveBeenLastCalledWith(
      expect.objectContaining({ avatarKind: undefined, title: 'Design' }),
    );
  });

  it("wears the agent's avatar for a direct channel", () => {
    useChannelStore.setState({
      listMap: { all: [listItem({ agentId: 'agt_c', title: '小C' })] },
    });
    useAgentStore.setState({
      agentMap: { agt_c: { avatar: '🌟', backgroundColor: '#f60' } as any },
    });

    expect(render()).toHaveBeenLastCalledWith(
      expect.objectContaining({
        avatar: '🌟',
        avatarKind: 'agent',
        avatarSeed: 'agt_c',
        backgroundColor: '#f60',
        title: '小C',
      }),
    );
  });

  it('clears the avatar once a loaded agent has none, even with a stale member avatar', () => {
    const channel = listItem({ agentId: 'agt_c', title: '小C' });
    useChannelStore.setState({
      detailMap: {
        [channelViewKey({ channelId: channel.id, threadId: null })]: {
          channel,
          members: [{ agentId: 'agt_c', avatar: '🌟' }],
        } as any,
      },
    });
    useAgentStore.setState({ agentMap: { agt_c: { avatar: null } as any } });

    expect(render()).toHaveBeenLastCalledWith(
      expect.objectContaining({ avatar: null, avatarKind: 'agent', avatarSeed: 'agt_c' }),
    );
  });

  it('falls back to the member avatar before the agent has loaded', () => {
    const channel = listItem({ agentId: 'agt_c', title: '小C' });
    useChannelStore.setState({
      detailMap: {
        [channelViewKey({ channelId: channel.id, threadId: null })]: {
          channel,
          members: [{ agentId: 'agt_c', avatar: '🌟' }],
        } as any,
      },
    });

    expect(render()).toHaveBeenLastCalledWith(
      expect.objectContaining({ avatar: '🌟', avatarKind: 'agent', avatarSeed: 'agt_c' }),
    );
  });
});
