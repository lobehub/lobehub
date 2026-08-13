import type { ChatTopic } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, useProjectionStore } from '@/projection';
import { useChatStore } from '@/store/chat';
import { getChatTopicById, getChatTopics } from '@/store/chat/slices/topic/projection';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

const AGENT_ID = 'agent-1';
const CONTAINER_KEY = topicMapKey({ agentId: AGENT_ID });

const topic = {
  createdAt: 100,
  id: 'topic-1',
  metadata: { repos: ['/repo'], workingDirectory: '/workspace' },
  status: 'active',
  title: 'Initial topic',
  updatedAt: 100,
} as ChatTopic;

const seedTopics = (items: ChatTopic[] = [topic]) => {
  getProjectionStoreState().commitChatTopicsPage(
    getCacheScope(),
    {
      containerKey: CONTAINER_KEY,
      context: { agentId: AGENT_ID },
      items,
      page: 0,
      pageSize: 20,
      signature: {},
      surface: 'sidebar',
      total: items.length,
    },
    { observedAt: 100, source: 'network' },
  );
};

describe('Chat topic actions backed by Projection', () => {
  beforeEach(() => {
    useProjectionStore.setState({ scopes: {} });
    useChatStore.setState({
      activeAgentId: AGENT_ID,
      activeGroupId: undefined,
      creatingTopicIds: [],
    });
  });

  it('updates a loaded topic without losing fragments omitted by the patch', () => {
    seedTopics();

    useChatStore.getState().internal_dispatchTopic({
      id: topic.id,
      type: 'updateTopic',
      value: { title: 'Renamed topic' },
    });

    expect(getChatTopicById(topic.id)).toMatchObject({
      metadata: topic.metadata,
      status: topic.status,
      title: 'Renamed topic',
    });
  });

  it('tracks an optimistic row until its server id replaces the temporary id', () => {
    seedTopics([]);

    useChatStore.getState().internal_dispatchTopic({
      agentId: AGENT_ID,
      optimistic: true,
      type: 'addTopic',
      value: { id: 'temp-topic', title: 'Draft topic' },
    });
    expect(useChatStore.getState().creatingTopicIds).toContain('temp-topic');
    expect(getChatTopics(CONTAINER_KEY)?.map(({ id }) => id)).toContain('temp-topic');

    useChatStore.getState().internal_dispatchTopic({
      id: 'temp-topic',
      nextId: 'topic-server',
      type: 'replaceTopicId',
    });
    expect(useChatStore.getState().creatingTopicIds).not.toContain('temp-topic');
    expect(getChatTopics(CONTAINER_KEY)?.map(({ id }) => id)).toEqual(['topic-server']);
  });

  it('removes the topic record and its collection membership together', () => {
    seedTopics();

    useChatStore.getState().internal_dispatchTopic({ id: topic.id, type: 'deleteTopic' });

    expect(getChatTopicById(topic.id)).toBeUndefined();
    expect(getChatTopics(CONTAINER_KEY)).toEqual([]);
  });
});
