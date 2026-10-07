import type { ChatTopic } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  refreshTopicDetail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: (state: AgentStoreState) => T) => selector(fixture.agent),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: <T,>(
    selector: (
      state: ChatStoreState & {
        useFetchTopicDetail: typeof fixture.useFetchTopicDetail;
        refreshTopicDetail: typeof fixture.refreshTopicDetail;
      },
    ) => T,
  ) =>
    selector({
      ...fixture.chat,
      useFetchTopicDetail: fixture.useFetchTopicDetail,
      refreshTopicDetail: fixture.refreshTopicDetail,
    }),
}));

describe('TopicRuntimeConfig', () => {
  beforeEach(() => {
    fixture.useFetchTopicDetail.mockClear();
    fixture.refreshTopicDetail.mockClear();
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

  /** @example A continued Task on the same Topic replaces op1's receipt with op2's receipt. */
  it('refreshes a mounted Topic inspector when the displayed operation changes', async () => {
    // ROOT CAUSE:
    //
    // TaskRunner continuations keep the same Topic ID. Its detail fetch therefore
    // stayed mounted with the old receipt after Task activity advanced to a new run.
    // Revalidate on the run change, then display the newest persisted Topic receipt.
    fixture.chat.topicDetailMap['run-1'] = {
      id: 'run-1',
      metadata: {
        heteroRuntimeConfig: {
          operationId: 'operation-1',
          fields: [{ key: 'model', source: 'task', value: 'gpt-5.4' }],
        },
      },
    } as ChatTopic;
    const { rerender } = render(
      <TopicRuntimeConfig agentId={'assignee'} operationId={'operation-1'} topicId={'run-1'} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    /** @example The current operation's persisted receipt is visible. */
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
    rerender(
      <TopicRuntimeConfig agentId={'assignee'} operationId={'operation-2'} topicId={'run-1'} />,
    );
    /** @example A same-Topic continuation triggers one by-id revalidation. */
    await waitFor(() => expect(fixture.refreshTopicDetail).toHaveBeenCalledWith('run-1'));
    /** @example Mounting and then continuing each request current Topic details. */
    expect(fixture.refreshTopicDetail).toHaveBeenCalledTimes(2);
    fixture.chat.topicDetailMap['run-1'] = {
      id: 'run-1',
      metadata: {
        heteroRuntimeConfig: {
          operationId: 'operation-2',
          fields: [{ key: 'model', source: 'task', value: 'gpt-5.5' }],
        },
      },
    } as ChatTopic;
    rerender(
      <TopicRuntimeConfig agentId={'assignee'} operationId={'operation-2'} topicId={'run-1'} />,
    );
    /** @example The refreshed receipt shows the new effective native model. */
    expect(screen.getByText('gpt-5.5', { exact: true })).toBeInTheDocument();
  });

  /** @example A drawer follow-up writes op2 while the Task association still points to op1. */
  it('keeps the latest Topic receipt visible after a follow-up settles', () => {
    // ROOT CAUSE:
    //
    // Ordinary drawer follow-ups update the Topic receipt without running TaskRunner.
    // The Task activity can keep op1 while the Topic has op2. Treating that activity
    // ID as a receipt filter would hide the actual follow-up configuration forever.
    fixture.chat.topicDetailMap['run-1'] = {
      id: 'run-1',
      metadata: {
        heteroRuntimeConfig: {
          operationId: 'operation-2',
          fields: [{ key: 'model', source: 'topic', value: 'gpt-5.5' }],
        },
      },
    } as ChatTopic;
    const { rerender } = render(
      <TopicRuntimeConfig agentId={'assignee'} operationId={'operation-2'} topicId={'run-1'} />,
    );
    rerender(
      <TopicRuntimeConfig agentId={'assignee'} operationId={'operation-1'} topicId={'run-1'} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    /** @example Clearing the running marker must not hide op2's native model. */
    expect(screen.getByText('gpt-5.5', { exact: true })).toBeInTheDocument();
    fixture.refreshTopicDetail.mockClear();
    fixture.chat.topicDetailMap['run-1'] = {
      ...fixture.chat.topicDetailMap['run-1'],
      metadata: {
        heteroRuntimeConfig: {
          operationId: 'operation-3',
          fields: [{ key: 'model', source: 'topic', value: 'gpt-5.4' }],
        },
      },
    } as ChatTopic;
    rerender(
      <TopicRuntimeConfig agentId={'assignee'} operationId={'operation-1'} topicId={'run-1'} />,
    );
    /** @example Receipt updates do not create a revalidation loop. */
    expect(fixture.refreshTopicDetail).not.toHaveBeenCalled();
    /** @example The by-id Topic remains the receipt source of truth. */
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
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
