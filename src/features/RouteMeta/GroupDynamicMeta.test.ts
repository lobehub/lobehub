import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DynamicRouteMeta, RouteMetaParams } from '@/spa/router/routeMeta';
import { useChatStore } from '@/store/chat';
import type { TopicData } from '@/store/chat/slices/topic/initialState';
import { useSessionStore } from '@/store/session';
import type { ChatTopic } from '@/types/topic';

import GroupDynamicMeta from './GroupDynamicMeta';

vi.mock('./workspaceScope', () => ({
  matchesRouteWorkspace: () => true,
  useRouteWorkspaceId: () => null,
}));

const topic = (id: string, title: string) => ({ id, title }) as ChatTopic;
const bucket = (...items: ChatTopic[]) => ({ items }) as TopicData;

const resolveTitle = (params: RouteMetaParams) => {
  const onResolve = vi.fn<(meta: DynamicRouteMeta) => void>();
  renderHook(() => GroupDynamicMeta({ onResolve, params }));
  return () => onResolve.mock.lastCall?.[0].title;
};

describe('GroupDynamicMeta', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessionGroups: [{ id: 'grp_1', name: 'Team' }] } as never);
  });

  afterEach(() => {
    useChatStore.setState({ topicDataMap: {}, topicDetailMap: {} });
    useSessionStore.setState({ sessionGroups: [] } as never);
  });

  it('titles a group topic route with the topic title', () => {
    useChatStore.setState({ topicDataMap: { group_grp_1: bucket(topic('tpc_1', 'Plan')) } });

    const title = resolveTitle({ gid: 'grp_1', topicId: 'tpc_1' });

    expect(title()).toBe('Plan');
  });

  it('publishes no title while the route topic row is not loaded', () => {
    useChatStore.setState({ topicDataMap: { group_grp_1: bucket(topic('tpc_1', 'Plan')) } });

    const title = resolveTitle({ gid: 'grp_1', topicId: 'tpc_1' });
    act(() => {
      useChatStore.setState({ topicDataMap: { group_grp_1: bucket() } });
    });

    expect(title()).toBeUndefined();
  });

  it('finds an archived topic in the detail cache', () => {
    useChatStore.setState({ topicDetailMap: { tpc_1: topic('tpc_1', 'Archived') } });

    const title = resolveTitle({ gid: 'grp_1', topicId: 'tpc_1' });

    expect(title()).toBe('Archived');
  });

  it('titles a route without a topic with the group name', () => {
    const title = resolveTitle({ gid: 'grp_1' });

    expect(title()).toBe('Team');
  });
});
