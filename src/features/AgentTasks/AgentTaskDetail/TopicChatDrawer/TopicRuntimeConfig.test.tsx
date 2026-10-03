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

/** @example A Task run opened from Home hydrates its own Topic independently of the active chat. */
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

  /** @example Cold Topic caches are fetched and reveal the dispatched receipt once loaded. */
  it('hydrates a cold run and preserves its receipt after Agent configuration changes', () => {
    // ROOT CAUSE:
    //
    // Task/system Topics are absent from normal chat lists. ConversationProvider
    // fetches Agents only, so reading a Topic selector could stay empty forever.
    // The inspector now invokes the existing by-id Topic hydration hook.
    const { rerender } = render(<TopicRuntimeConfig agentId={'assignee'} topicId={'run-1'} />);
    /** @example Loading uses the explicitly inspected run ID. */
    expect(fixture.useFetchTopicDetail).toHaveBeenCalledWith('run-1');
    /** @example An unloaded Topic cannot be represented as an Agent-default run. */
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    // ROOT CAUSE:
    // A Topic list can retain its pre-dispatch row after by-id hydration loads a
    // receipt. The generic lookup prefers that list, hiding the actual run.
    // Prefer fetched details in the inspector so later Agent edits cannot drift it.
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
    /** @example The historical configuration stays readable after the Agent runtime is removed. */
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
    /** @example Model and effort retain their Topic provenance. */
    expect(screen.getAllByText('taskDetail.runtimeConfig.source.topic')).toHaveLength(2);
    /** @example The scope distinguishes an actual dispatch receipt from a current preview. */
    expect(screen.getByText('taskDetail.runtimeConfig.runScope')).toBeInTheDocument();
  });

  /** @example A fetched Topic pin also wins when this older run has no dispatch receipt. */
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
    /** @example The model and effort both come from the fetched detail row. */
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
    /** @example Independent Topic effort survives the stale list row. */
    expect(screen.getByText('low', { exact: true })).toBeInTheDocument();
    /** @example A preview without a receipt is not labelled as an audited dispatch. */
    expect(screen.getByText('taskDetail.runtimeConfig.topicScope')).toBeInTheDocument();
  });
  /** @example Two Topics of the same Agent display their own Fast and Standard selections. */
  it('labels both explicit speed selections as Topic pins', () => {
    // ROOT CAUSE:
    // The shared inspector resolved Topic speed but ignored pin.speed for its
    // source. Exercise the real Topic selector, resolver and rendered inspector.
    fixture.agent.agentMap.assignee.agencyConfig!.heterogeneousProvider!.speed = 'fast';
    fixture.chat.topicDetailMap['run-1'] = {
      id: 'run-1',
      metadata: { heteroSpeed: 'default' },
    } as ChatTopic;
    fixture.chat.topicDetailMap['run-2'] = {
      id: 'run-2',
      metadata: { heteroSpeed: 'fast' },
    } as ChatTopic;
    const { rerender } = render(<TopicRuntimeConfig agentId={'assignee'} topicId={'run-1'} />);
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    /** @example Explicit Standard is a resolved selection, not a device-default model. */
    expect(screen.getByText('heteroAgent.modelSelector.speed.standard')).toBeInTheDocument();
    /** @example Standard identifies its Topic source. */
    expect(screen.getByText('taskDetail.runtimeConfig.source.topic')).toBeInTheDocument();
    rerender(<TopicRuntimeConfig agentId={'assignee'} topicId={'run-2'} />);
    /** @example Switching Topics reveals the second Topic's independent speed pin. */
    expect(screen.getByText('fast', { exact: true })).toBeInTheDocument();
    /** @example Explicit Fast remains Topic-owned even when it equals the Agent default. */
    expect(screen.getByText('taskDetail.runtimeConfig.source.topic')).toBeInTheDocument();
  });
});
