/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalChatProvider } from './GoalChatProvider';

const hooks = vi.hoisted(() => ({
  useGatewayReconnect: vi.fn(),
  useTopicRunEvents: vi.fn(),
}));

const marker = vi.hoisted(() => ({
  assistantMessageId: 'msg_1',
  heteroType: 'claude-code',
  operationId: 'op_live',
}));

vi.mock('@/hooks/useGatewayReconnect', () => ({ useGatewayReconnect: hooks.useGatewayReconnect }));
vi.mock('@/hooks/useTopicRunEvents', () => ({ useTopicRunEvents: hooks.useTopicRunEvents }));
vi.mock('@/hooks/useOperationState', () => ({ useOperationState: () => ({}) }));

vi.mock('@/features/Conversation', () => ({
  ConversationProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/store/agent', () => {
  const state = { activeAgentId: 'agt_goal', setActiveAgentId: vi.fn() };
  const useAgentStore = (selector: (s: typeof state) => unknown) => selector(state);
  useAgentStore.getState = () => state;
  return { useAgentStore };
});

vi.mock('@/store/chat', () => {
  const state = {
    activeAgentId: 'agt_goal',
    activeTopicId: 'tpc_goal',
    switchTopic: vi.fn(),
    topicDataMap: {
      agent_agt_goal: { items: [{ id: 'tpc_goal', metadata: { runningOperation: marker } }] },
    },
  };
  const useChatStore = (selector: (s: typeof state) => unknown) => selector(state);
  useChatStore.getState = () => state;
  useChatStore.setState = vi.fn();
  return { useChatStore };
});

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (s: any) =>
      Object.values(s.topicDataMap as Record<string, { items: any[] }>)
        .flatMap((bucket) => bucket.items)
        .find((topic) => topic.id === id),
  },
}));

beforeEach(() => {
  hooks.useGatewayReconnect.mockReset();
  hooks.useTopicRunEvents.mockReset();
});

describe('GoalChatProvider', () => {
  // ROOT CAUSE (T-13930):
  //
  // The goal page's supervision conversation never followed a run already going
  // on its topic. Opened after a reload or in a new window, it had no local
  // operation for a Claude Code run still waiting on a background task, so the
  // composer read idle; the next message started a second run, the live CLI's
  // output was discarded as stale and the CLI stopped, killing that task.
  //
  // Before: no reconnect on this surface. After: it reconnects like the agent page.
  it('follows the run still going on its topic', () => {
    render(
      <GoalChatProvider pinned agentId="agt_goal" goalId="goal_1" initialTopicId="tpc_goal">
        <div />
      </GoalChatProvider>,
    );

    expect(hooks.useGatewayReconnect).toHaveBeenCalledWith('tpc_goal', marker, 'agt_goal');
    expect(hooks.useTopicRunEvents).toHaveBeenCalledWith('tpc_goal', 'agt_goal');
  });
});
