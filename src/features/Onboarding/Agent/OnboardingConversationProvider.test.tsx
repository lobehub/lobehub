import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_OPERATION_STATE } from '@/features/Conversation/types/operation';

import OnboardingConversationProvider from './OnboardingConversationProvider';

const mockOperationState = {
  getMessageOperationState: vi.fn(() => ({
    isContinuing: false,
    isCreating: false,
    isGenerating: true,
    isInReasoning: false,
    isProcessing: true,
    isRegenerating: false,
  })),
  getToolOperationState: vi.fn(() => ({
    isInvoking: true,
    isStreaming: true,
  })),
  isAIGenerating: true,
  isInputLoading: true,
  sendMessageError: undefined,
};

const conversationProviderSpy = vi.fn();

vi.mock('@/features/Conversation', () => ({
  ConversationProvider: (props: {
    children: ReactNode;
    onMessagesChange?: unknown;
    operationState?: unknown;
    skipFetch?: boolean;
  }) => {
    conversationProviderSpy(props);
    return <div data-testid="conversation-provider">{props.children}</div>;
  },
}));

vi.mock('@/hooks/useOperationState', () => ({
  useOperationState: () => mockOperationState,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: any) => unknown) =>
    selector({
      dbMessagesMap: {
        'agent-1::topic-1': [{ content: 'hello', id: 'assistant-1' }],
      },
      replaceMessages: vi.fn(),
    }),
}));

vi.mock('@/store/chat/utils/messageMapKey', () => ({
  messageMapKey: () => 'agent-1::topic-1',
}));

describe('OnboardingConversationProvider', () => {
  it('uses default non-streaming operation state when frozen', () => {
    render(
      <OnboardingConversationProvider frozen agentId="agent-1" topicId="topic-1">
        <div>child</div>
      </OnboardingConversationProvider>,
    );

    expect(screen.getByTestId('conversation-provider')).toBeInTheDocument();
    expect(conversationProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        onMessagesChange: undefined,
        operationState: DEFAULT_OPERATION_STATE,
        skipFetch: true,
      }),
    );
  });

  it('keeps live operation state when not frozen', () => {
    render(
      <OnboardingConversationProvider agentId="agent-1" frozen={false} topicId="topic-1">
        <div>child</div>
      </OnboardingConversationProvider>,
    );

    expect(conversationProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operationState: mockOperationState,
        skipFetch: false,
      }),
    );
  });
});
