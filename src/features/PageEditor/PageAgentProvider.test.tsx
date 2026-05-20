/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageAgentProvider } from './PageAgentProvider';

interface AgentState {
  activeAgentId?: string;
  pageAgentId: string;
  setActiveAgentId: (agentId: string) => void;
  useInitBuiltinAgent: (slug: string) => void;
}

interface ChatState {
  activeAgentId?: string;
  activeTopicId?: string | null;
  dbMessagesMap: Record<string, unknown[]>;
  replaceMessages: (messages: unknown[], options: unknown) => void;
  switchTopic: (topicId: string | null, options: unknown) => Promise<void>;
}

const conversationProviderSpy = vi.fn();
const operationState = { isInputLoading: false };

let agentState: AgentState;
let chatState: ChatState;

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: () => <div data-testid="loading" />,
}));

vi.mock('@/features/Conversation', () => ({
  ConversationProvider: (props: { children: ReactNode }) => {
    conversationProviderSpy(props);
    return <div data-testid="conversation-provider">{props.children}</div>;
  },
}));

vi.mock('@/hooks/useOperationState', () => ({
  useOperationState: () => operationState,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: Object.assign((selector: (state: AgentState) => unknown) => selector(agentState), {
    getState: () => agentState,
  }),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    pageAgentId: (state: AgentState) => state.pageAgentId,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign((selector: (state: ChatState) => unknown) => selector(chatState), {
    getState: () => chatState,
    setState: (partial: Partial<ChatState>) => {
      chatState = { ...chatState, ...partial };
    },
  }),
}));

vi.mock('@/store/chat/utils/messageMapKey', () => ({
  messageMapKey: (context: { agentId?: string; scope?: string; topicId?: string | null }) =>
    `${context.scope}_${context.agentId}_${context.topicId ?? 'new'}`,
}));

beforeEach(() => {
  conversationProviderSpy.mockClear();

  agentState = {
    activeAgentId: 'page-agent',
    pageAgentId: 'page-agent',
    setActiveAgentId: vi.fn((agentId: string) => {
      agentState.activeAgentId = agentId;
    }),
    useInitBuiltinAgent: vi.fn(),
  };

  chatState = {
    activeAgentId: 'previous-agent',
    activeTopicId: 'stale-topic',
    dbMessagesMap: {},
    replaceMessages: vi.fn(),
    switchTopic: vi.fn(async () => {}),
  };
});

describe('PageAgentProvider', () => {
  it('resets a stale page topic on initial scoped agent sync only', async () => {
    const { rerender } = render(
      <PageAgentProvider>
        <div>child</div>
      </PageAgentProvider>,
    );

    await waitFor(() => {
      expect(chatState.switchTopic).toHaveBeenCalledWith(null, {
        scope: 'page',
        skipRefreshMessage: true,
      });
    });

    chatState.activeTopicId = 'created-topic';

    rerender(
      <PageAgentProvider>
        <div>child</div>
      </PageAgentProvider>,
    );

    expect(chatState.switchTopic).toHaveBeenCalledTimes(1);
  });

  it('resets transient state on scoped agent sync even without an active topic', async () => {
    chatState.activeTopicId = null;

    render(
      <PageAgentProvider>
        <div>child</div>
      </PageAgentProvider>,
    );

    await waitFor(() => {
      expect(chatState.switchTopic).toHaveBeenCalledWith(null, {
        scope: 'page',
        skipRefreshMessage: true,
      });
    });
  });

  it('resets the page topic when the scoped agent changes', async () => {
    const { rerender } = render(
      <PageAgentProvider>
        <div>child</div>
      </PageAgentProvider>,
    );

    await waitFor(() => {
      expect(chatState.switchTopic).toHaveBeenCalledTimes(1);
    });

    agentState.activeAgentId = 'next-agent';
    chatState.activeTopicId = 'other-topic';

    rerender(
      <PageAgentProvider>
        <div>child</div>
      </PageAgentProvider>,
    );

    await waitFor(() => {
      expect(chatState.switchTopic).toHaveBeenCalledTimes(2);
    });
  });
});
