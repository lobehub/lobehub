/**
 * @vitest-environment happy-dom
 */
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskAgentProvider, useTaskAgentSelection } from './TaskAgentProvider';

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
    activeAgentId: undefined as string | undefined,
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

const SelectAgentButton = ({ agentId }: { agentId: string }) => {
  const selectTaskAgent = useTaskAgentSelection();
  return <button onClick={() => selectTaskAgent(agentId)}>select agent</button>;
};

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve));

describe('TaskAgentProvider', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/tasks');
    mocks.agentState.activeAgentId = undefined;
    mocks.agentState.setActiveAgentId.mockClear();
    mocks.chatState.activeAgentId = undefined;
    mocks.chatState.activeTopicId = null;
    mocks.chatState.dbMessagesMap = {};
    mocks.chatState.replaceMessages.mockClear();
    mocks.chatState.switchTopic.mockClear();
    mocks.initBuiltinAgent.mockClear();
    mocks.providerContexts = [];
    mocks.routeMatch = undefined;
  });

  afterEach(async () => {
    window.history.pushState(null, '', '/agent/cleanup');
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('defaults to the task agent when the global active agent comes from another page', async () => {
    mocks.agentState.activeAgentId = 'agt_lobe';
    mocks.chatState.activeAgentId = 'agt_lobe';
    mocks.chatState.activeTopicId = 'tpc_lobe';

    render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.providerContexts.at(-1)?.agentId).toBe('agt_task');
    });
    expect(mocks.agentState.setActiveAgentId).toHaveBeenCalledWith('agt_task');
    expect(mocks.chatState.activeAgentId).toBe('agt_task');
    expect(mocks.chatState.switchTopic).toHaveBeenCalledWith(null, {
      scope: 'task',
      skipRefreshMessage: true,
    });
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

  it('keeps the current task topic when task list/detail navigation remounts the provider', async () => {
    const firstRender = render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.chatState.activeAgentId).toBe('agt_task');
    });

    mocks.chatState.switchTopic.mockClear();
    mocks.chatState.activeTopicId = 'tpc_created';

    firstRender.unmount();

    render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.providerContexts.at(-1)?.topicId).toBe('tpc_created');
    });
    expect(mocks.chatState.switchTopic).not.toHaveBeenCalled();
  });

  it('keeps the current task topic when lazy task navigation remounts after cleanup runs', async () => {
    const firstRender = render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.chatState.activeAgentId).toBe('agt_task');
    });

    mocks.chatState.switchTopic.mockClear();
    mocks.chatState.activeTopicId = 'tpc_created';
    window.history.pushState(null, '', '/task/T-1');

    firstRender.unmount();
    await flushMicrotasks();

    render(
      <TaskAgentProvider>
        <div>content</div>
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.providerContexts.at(-1)?.topicId).toBe('tpc_created');
    });
    expect(mocks.chatState.switchTopic).not.toHaveBeenCalled();
  });

  it('allows the task manager selector to switch the scoped agent', async () => {
    render(
      <TaskAgentProvider>
        <SelectAgentButton agentId="agt_custom" />
      </TaskAgentProvider>,
    );

    await waitFor(() => {
      expect(mocks.chatState.activeAgentId).toBe('agt_task');
    });

    mocks.chatState.switchTopic.mockClear();
    mocks.chatState.activeTopicId = 'tpc_task';

    fireEvent.click(screen.getByText('select agent'));

    await waitFor(() => {
      expect(mocks.providerContexts.at(-1)?.agentId).toBe('agt_custom');
    });
    expect(mocks.agentState.setActiveAgentId).toHaveBeenLastCalledWith('agt_custom');
    expect(mocks.chatState.activeAgentId).toBe('agt_custom');
    expect(mocks.chatState.switchTopic).toHaveBeenCalledWith(null, {
      scope: 'task',
      skipRefreshMessage: true,
    });
  });

  it('resets transient state on scoped agent sync even without an active topic', async () => {
    mocks.agentState.activeAgentId = 'agt_task';
    mocks.chatState.activeAgentId = 'agt_previous';
    mocks.chatState.activeTopicId = null;

    render(
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
    expect(mocks.chatState.activeAgentId).toBe('agt_task');
  });
});
