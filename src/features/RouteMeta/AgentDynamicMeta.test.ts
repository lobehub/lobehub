import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DynamicRouteMeta, RouteMetaParams } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import type { TopicData } from '@/store/chat/slices/topic/initialState';
import type { ChatTopic } from '@/types/topic';

import AgentDynamicMeta from './AgentDynamicMeta';

vi.mock('./workspaceScope', () => ({
  matchesRouteWorkspace: () => true,
  useRouteWorkspaceId: () => null,
}));

const topic = (id: string, title: string) => ({ id, title }) as ChatTopic;
const bucket = (...items: ChatTopic[]) => ({ items }) as TopicData;

const resolveTitle = (params: RouteMetaParams) => {
  const onResolve = vi.fn<(meta: DynamicRouteMeta) => void>();
  renderHook(() => AgentDynamicMeta({ onResolve, params }));
  return () => onResolve.mock.lastCall?.[0].title;
};

describe('AgentDynamicMeta', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agentMap: { agt_inbox: { title: 'Lobe AI', workspaceId: null } },
    } as never);
  });

  afterEach(() => {
    useChatStore.setState({ topicDataMap: {}, topicDetailMap: {} });
    useAgentStore.setState({ agentMap: {} } as never);
  });

  it('titles a topic route with the topic and the agent name', () => {
    useChatStore.setState({
      topicDataMap: { agent_agt_inbox: bucket(topic('tpc_1', 'Fix login')) },
    });

    const title = resolveTitle({ aid: 'agt_inbox', topicId: 'tpc_1' });

    expect(title()).toBe('Fix login · Lobe AI');
  });

  // The desktop tab cache keeps any non-empty title it is handed, so publishing the bare
  // agent name while the topic row is momentarily missing (list bucket replaced on
  // revalidation or a cache-scope switch) overwrote the tab's topic title with "Lobe AI".
  it('publishes no title while the route topic row is not loaded', () => {
    useChatStore.setState({
      topicDataMap: { agent_agt_inbox: bucket(topic('tpc_1', 'Fix login')) },
    });

    const title = resolveTitle({ aid: 'agt_inbox', topicId: 'tpc_1' });
    act(() => {
      useChatStore.setState({ topicDataMap: { agent_agt_inbox: bucket(topic('tpc_2', 'Other')) } });
    });

    expect(title()).toBeUndefined();
  });

  it('finds the topic in another loaded bucket', () => {
    useChatStore.setState({
      topicDataMap: { group_agent_grp_1_agt_inbox: bucket(topic('tpc_1', 'Fix login')) },
    });

    const title = resolveTitle({ aid: 'agt_inbox', topicId: 'tpc_1' });

    expect(title()).toBe('Fix login · Lobe AI');
  });

  it('finds an archived topic in the detail cache', () => {
    useChatStore.setState({ topicDetailMap: { tpc_1: topic('tpc_1', 'Archived') } });

    const title = resolveTitle({ aid: 'agt_inbox', topicId: 'tpc_1' });

    expect(title()).toBe('Archived · Lobe AI');
  });

  it('falls back to the agent name for a loaded but untitled topic', () => {
    useChatStore.setState({ topicDataMap: { agent_agt_inbox: bucket(topic('tpc_1', '')) } });

    const title = resolveTitle({ aid: 'agt_inbox', topicId: 'tpc_1' });

    expect(title()).toBe('Lobe AI');
  });

  it('titles a route without a topic with the agent name', () => {
    const title = resolveTitle({ aid: 'agt_inbox' });

    expect(title()).toBe('Lobe AI');
  });
});
