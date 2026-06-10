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
    pendingInterventions: [] as Array<{ id: string }>,
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
    headerSlot,
    itemContent,
    showWelcome,
    welcome,
  }: {
    headerSlot?: ReactNode;
    itemContent?: (index: number, id: string) => ReactNode;
    showWelcome?: boolean;
    welcome?: ReactNode;
  }) => (
    <div data-testid="chat-list">
      {headerSlot ? <div data-testid="chat-header">{headerSlot}</div> : null}
      {showWelcome ? <div data-testid="chat-welcome">{welcome}</div> : null}
      {mockState.displayMessages.map((message, index) => (
        <div key={message.id}>{itemContent?.(index, message.id)}</div>
      ))}
    </div>
  ),
  MessageItem: (props: { defaultWorkflowExpandLevel?: string; id: string }) => {
    messageItemSpy(props);

    return <div data-testid={`message-item-${props.id}`}>{props.id}</div>;
  },
  conversationSelectors: {
    displayMessages: (state: typeof mockState) => state.displayMessages,
  },
  dataSelectors: {
    displayMessages: (state: typeof mockState) => state.displayMessages,
  },
  useConversationStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock('@/features/Conversation/hooks/useAgentMeta', () => ({
  useAgentMeta: () => ({
    avatar: 'assistant-avatar',
    backgroundColor: '#000',
    title: 'Onboarding Agent',
  }),
}));

vi.mock('./Welcome', () => ({
  default: () => <div data-testid="welcome-screen">Welcome screen</div>,
}));

vi.mock('./WelcomeMessage', () => ({
  default: () => <div data-testid="welcome-message">Welcome message</div>,
}));

describe('AgentOnboardingConversation', () => {
  beforeEach(() => {
    chatInputSpy.mockClear();
    messageItemSpy.mockClear();
    mockState.displayMessages = [];
    mockState.pendingInterventions = [];
  });

  it('renders a read-only transcript when viewing a historical topic', () => {
    mockState.displayMessages = [{ id: 'assistant-1', role: 'assistant' }];

    render(<AgentOnboardingConversation readOnly />);

    expect(screen.queryByTestId('chat-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-list')).toBeInTheDocument();
  });

  it('renders the onboarding greeting without any completion CTA', () => {
    mockState.displayMessages = [];

    render(<AgentOnboardingConversation />);

    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument();
    expect(screen.getByText('Welcome screen')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-header')).not.toBeInTheDocument();
    expect(screen.queryByText('finish')).not.toBeInTheDocument();
  });

  it('suppresses the welcome flash while a returning user’s messages are still fetching', () => {
    // Returning user: bootstrap says hasMessages=true but ChatList has not yet
    // hydrated displayMessages — the welcome MUST stay hidden so we do not show
    // a misleading "fresh" greeting before the transcript loads.
    mockState.displayMessages = [];

    render(<AgentOnboardingConversation hasMessages />);

    expect(screen.queryByTestId('chat-welcome')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-header')).not.toBeInTheDocument();
    expect(screen.queryByText('Welcome screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Welcome message')).not.toBeInTheDocument();
  });

  it('keeps the synthetic welcome as the first list item after real messages exist', () => {
    mockState.displayMessages = [
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
    ];

    render(<AgentOnboardingConversation hasMessages />);

    const listItems = screen.getByTestId('chat-list').children;
    expect(listItems[0]).toHaveAttribute('data-testid', 'chat-header');
    expect(screen.getByTestId('message-item-user-1')).toBeInTheDocument();
    expect(screen.getByTestId('message-item-assistant-1')).toBeInTheDocument();
  });

  it('does not duplicate welcome when a legacy persisted assistant opener exists', () => {
    mockState.displayMessages = [
      { id: 'assistant-welcome', role: 'assistant' },
      { id: 'user-1', role: 'user' },
    ];

    render(<AgentOnboardingConversation hasMessages />);

    expect(screen.queryByTestId('chat-header')).not.toBeInTheDocument();
  });

  it('forwards isInputReady=false to ChatInput as isConfigLoading', () => {
    mockState.displayMessages = [];

    render(<AgentOnboardingConversation isInputReady={false} />);

    expect(chatInputSpy).toHaveBeenCalledWith(expect.objectContaining({ isConfigLoading: true }));
  });

  it('disables expand and runtime config in chat input', () => {
    mockState.displayMessages = [{ id: 'assistant-1', role: 'assistant' }];

    render(<AgentOnboardingConversation />);

    expect(chatInputSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        allowExpand: false,
        leftActions: [],
        rightActions: [],
        showControlBar: false,
      }),
    );
  });

  it('disables input completion, / @ triggers, follow-up placeholder, and message queueing', () => {
    mockState.displayMessages = [{ id: 'assistant-1', role: 'assistant' }];

    render(<AgentOnboardingConversation />);

    expect(chatInputSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        disableFollowUpVariant: true,
        disableQueue: true,
        feature: expect.objectContaining({
          inputCompletion: false,
          mention: false,
          slash: false,
        }),
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
        defaultWorkflowExpandLevel: 'collapsed',
      }),
    );
  });
});

vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    pendingInterventions: (state: typeof mockState) => state.pendingInterventions,
  },
}));
