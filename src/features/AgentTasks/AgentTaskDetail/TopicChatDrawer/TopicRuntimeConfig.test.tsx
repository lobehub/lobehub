import type { ChatTopic } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStoreState } from '@/store/agent/initialState';
import { initialState as initialAgentState } from '@/store/agent/initialState';
import type { ChatStoreState } from '@/store/chat/initialState';
import { initialState as initialChatState } from '@/store/chat/initialState';

import { TopicRuntimeConfig } from './TopicRuntimeConfig';

const fixture = vi.hoisted(() => ({
  agent: {} as AgentStoreState,
  chat: {} as ChatStoreState,
  useFetchTopicDetail: vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: (state: AgentStoreState) => T) => selector(fixture.agent),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: <T,>(
    selector: (
      state: ChatStoreState & { useFetchTopicDetail: typeof fixture.useFetchTopicDetail },
    ) => T,
  ) => selector({ ...fixture.chat, useFetchTopicDetail: fixture.useFetchTopicDetail }),
}));

describe('TopicRuntimeConfig', () => {
  beforeEach(() => {
    fixture.useFetchTopicDetail.mockClear();
    fixture.agent = {
      ...initialAgentState,
      agentMap: {
        assignee: {
          agencyConfig: { heterogeneousProvider: { model: 'gpt-5.5', type: 'codex' } },
        },
      },
    };
    fixture.chat = { ...initialChatState, topicDetailMap: {} };
  });

  it('hydrates a cold run and preserves its receipt after Agent configuration changes', () => {
    const { rerender } = render(<TopicRuntimeConfig agentId={'assignee'} topicId={'run-1'} />);
    expect(fixture.useFetchTopicDetail).toHaveBeenCalledWith('run-1');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    fixture.chat.topicDataMap.agent_assignee = {
      currentPage: 1,
      hasMore: false,
      pageSize: 20,
      total: 1,
      items: [{ id: 'run-1', model: 'gpt-5.5', provider: 'codex' } as ChatTopic],
    };
    fixture.chat.topicDetailMap['run-1'] = {
      id: 'run-1',
      metadata: {
        heteroRuntimeConfig: {
          fields: [
            { key: 'runtime', source: 'agent', value: 'codex' },
            { key: 'model', source: 'topic', value: 'gpt-5.4' },
            { key: 'effort', source: 'topic', value: 'low' },
            { key: 'speed', source: 'agent', value: 'fast' },
          ],
          operationId: 'operation-1',
        },
      },
    } as ChatTopic;
    fixture.agent.agentMap.assignee = {};
    rerender(<TopicRuntimeConfig agentId={'assignee'} topicId={'run-1'} />);
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText('taskDetail.runtimeConfig.source.topic')).toHaveLength(2);
    expect(screen.getByText('taskDetail.runtimeConfig.runScope')).toBeInTheDocument();
  });

  it('previews fetched Topic pins instead of an older list snapshot', () => {
    fixture.chat.topicDataMap.agent_assignee = {
      currentPage: 1,
      hasMore: false,
      pageSize: 20,
      total: 1,
      items: [{ id: 'run-1', model: 'gpt-5.5', provider: 'codex' } as ChatTopic],
    };
    fixture.chat.topicDetailMap['run-1'] = {
      id: 'run-1',
      model: 'gpt-5.4',
      provider: 'codex',
      metadata: { heteroEffort: 'low' },
    } as ChatTopic;
    render(<TopicRuntimeConfig agentId={'assignee'} topicId={'run-1'} />);
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('low', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('taskDetail.runtimeConfig.topicScope')).toBeInTheDocument();
  });
});
