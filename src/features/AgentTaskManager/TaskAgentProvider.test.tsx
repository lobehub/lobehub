/**
 * @vitest-environment happy-dom
 */
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskAgentProvider } from './TaskAgentProvider';

const mocks = vi.hoisted(() => {
  const agentState = {
    activeAgentId: undefined as string | undefined,
    builtinAgentIdMap: {
      'task-agent': 'agt_task',
      'inbox': 'agt_inbox',
    },
    setActiveAgentId: vi.fn((id: string) => {
      agentState.activeAgentId = id;
    }),
  };

  const chatState = {
    activeTopicId: null as string | null | undefined,
    dbMessagesMap: {} as Record<string, unknown[]>,
    replaceMessages: vi.fn(),
    switchTopic: vi.fn((id: string | null) => {
      chatState.activeTopicId = id;
      return Promise.resolve();
    }),
  };

  return {
    agentState,
    chatState,
    initBuiltinAgent: vi.fn(),
    operationState: undefined,
    providerContexts: [] as any[],
    routeMatch: undefined as { params: { taskId?: string } } | undefined,
  };
});

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: ({ debugId }: { debugId: string }) => <div data-testid="loading">{debugId}</div>,
}));

vi.mock('@/features/Conversation', () => ({
  ConversationProvider: ({ children, context }: { children: ReactNode; context: any }) => {
    mocks.providerContexts.push(context);
    return <div data-testid="conversation-provider">{children}</div>;
  },
}));

vi.mock('@/hooks/useInitBuiltinAgent', () => ({
  useInitBuiltinAgent: (slug: string) => mocks.initBuiltinAgent(slug),
}));

vi.mock('@/hooks/useOperationState', () => ({
  useOperationState: () => mocks.operationState,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: Object.assign(
    (selector: (state: typeof mocks.agentState) => unknown) => {
      return selector(mocks.agentState);
    },
    {
      getState: () => mocks.agentState,
    },
  ),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof mocks.chatState) => unknown) => {
      return selector(mocks.chatState);
    },
    {
      getState: () => mocks.chatState,
      setState: (partial: Partial<typeof mocks.chatState>) => {
        Object.assign(mocks.chatState, partial);
      },
    },
  ),
}));

vi.mock('react-router-dom', () => ({
  useMatch: () => mocks.routeMatch,
}));

describe('TaskAgentProvider', () => {
  beforeEach(() => {
    mocks.agentState.activeAgentId = undefined;
    mocks.agentState.setActiveAgentId.mockClear();
    mocks.chatState.activeTopicId = null;
    mocks.chatState.dbMessagesMap = {};
    mocks.chatState.replaceMessages.mockClear();
    mocks.chatState.switchTopic.mockClear();
    mocks.initBuiltinAgent.mockClear();
    mocks.providerContexts = [];
    mocks.routeMatch = undefined;
  });

  it('initializes builtin agents and builds task list context', () => {
    render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    expect(mocks.initBuiltinAgent).toHaveBeenCalledWith(BUILTIN_AGENT_SLUGS.inbox);
    expect(mocks.initBuiltinAgent).toHaveBeenCalledWith(BUILTIN_AGENT_SLUGS.taskAgent);
    expect(mocks.providerContexts.at(-1)).toMatchObject({
      agentId: 'agt_task',
      defaultTaskAssigneeAgentId: 'agt_inbox',
      scope: 'task',
      topicId: null,
      viewedTask: { type: 'list' },
    });
  });

  it('forwards the viewed task detail context from the route', () => {
    mocks.routeMatch = { params: { taskId: 'T-1' } };

    render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    expect(mocks.providerContexts.at(-1)?.viewedTask).toEqual({ taskId: 'T-1', type: 'detail' });
  });

  it('clears a stale topic only once for the selected agent', async () => {
    mocks.chatState.activeTopicId = 'tpc_stale';

    const { rerender } = render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.chatState.switchTopic).toHaveBeenCalledWith(null, {
        scope: 'task',
        skipRefreshMessage: true,
      });
    });

    mocks.chatState.switchTopic.mockClear();
    mocks.chatState.activeTopicId = 'tpc_created';

    rerender(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.providerContexts.at(-1)?.topicId).toBe('tpc_created');
    });
    expect(mocks.chatState.switchTopic).not.toHaveBeenCalled();
  });
});
