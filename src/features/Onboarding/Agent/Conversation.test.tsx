import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '@/utils/env';

import AgentOnboardingConversation from './Conversation';

// Prevent unhandled rejections from @splinetool/runtime fetching remote assets in CI
vi.mock('@lobehub/ui/brand', () => ({
  LobeHub: () => null,
  LogoThree: () => null,
}));

const { chatInputSpy, messageItemSpy, mockState } = vi.hoisted(() => ({
  chatInputSpy: vi.fn(),
  messageItemSpy: vi.fn(),
  mockState: {
    displayMessages: [] as Array<{ content?: string; id: string; role: string }>,
  },
}));

vi.mock('@/utils/env', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();

  return {
    ...actual,
    isDev: false,
  };
});

vi.mock('@/features/Conversation', () => ({
  ChatInput: (props: Record<string, unknown>) => {
    chatInputSpy(props);

    return <div data-testid="chat-input" />;
  },
  ChatList: ({
    itemContent,
    showWelcome,
    welcome,
  }: {
    itemContent?: (index: number, id: string) => ReactNode;
    showWelcome?: boolean;
    welcome?: ReactNode;
  }) => (
    <div data-testid="chat-list">
      {showWelcome ? <div data-testid="chat-welcome">{welcome}</div> : null}
      {mockState.displayMessages.map((message, index) => (
        <div key={message.id}>{itemContent?.(index, message.id)}</div>
      ))}
    </div>
  ),
  MessageItem: (props: { defaultWorkflowExpanded?: boolean; id: string }) => {
    messageItemSpy(props);

    return <div data-testid={`message-item-${props.id}`}>{props.id}</div>;
  },
  conversationSelectors: {
    displayMessages: (state: typeof mockState) => state.displayMessages,
  },
  dataSelectors: {
    displayMessages: (state: typeof mockState) => state.displayMessages,
  },
  useConversationStore: (
    selector: (state: { displayMessages: typeof mockState.displayMessages }) => unknown,
  ) =>
    selector({
      displayMessages: mockState.displayMessages,
    }),
}));

vi.mock('@/features/Conversation/hooks/useAgentMeta', () => ({
  useAgentMeta: () => ({
    avatar: 'assistant-avatar',
    backgroundColor: '#000',
    title: 'Onboarding Agent',
  }),
}));

vi.mock('./Welcome', () => ({
  default: ({ content }: { content: string }) => <div data-testid="welcome-content">{content}</div>,
}));

describe('AgentOnboardingConversation', () => {
  beforeEach(() => {
    chatInputSpy.mockClear();
    messageItemSpy.mockClear();
    mockState.displayMessages = [];
  });

  it('renders a read-only transcript when viewing a historical topic', () => {
    mockState.displayMessages = [{ id: 'assistant-1', role: 'assistant' }];

    render(<AgentOnboardingConversation readOnly />);

    expect(screen.queryByTestId('chat-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-list')).toBeInTheDocument();
  });

  it('renders the onboarding greeting without any completion CTA', () => {
    mockState.displayMessages = [{ content: 'Welcome', id: 'assistant-1', role: 'assistant' }];

    render(<AgentOnboardingConversation />);

    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.queryByText('finish')).not.toBeInTheDocument();
  });

  it('disables expand and runtime config in chat input', () => {
    mockState.displayMessages = [{ id: 'assistant-1', role: 'assistant' }];

    render(<AgentOnboardingConversation />);

    expect(chatInputSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        allowExpand: false,
        leftActions: [],
        rightActions: [],
        showRuntimeConfig: false,
      }),
    );
  });

  it('renders normal message items outside the greeting state', () => {
    mockState.displayMessages = [
      { id: 'assistant-1', role: 'assistant' },
      { id: 'user-1', role: 'user' },
      { id: 'assistant-2', role: 'assistant' },
    ];

    render(<AgentOnboardingConversation />);

    expect(screen.getByTestId('message-item-assistant-2')).toBeInTheDocument();
    expect(screen.queryByText('finish')).not.toBeInTheDocument();
  });

  it('passes collapsed workflow default to onboarding message items', () => {
    mockState.displayMessages = [
      { id: 'assistant-1', role: 'assistant' },
      { id: 'user-1', role: 'user' },
    ];

    render(<AgentOnboardingConversation />);

    expect(messageItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultWorkflowExpanded: false,
      }),
    );
  });
});
