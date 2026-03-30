import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '@/utils/env';

import AgentOnboardingConversation from './Conversation';

// Prevent unhandled rejections from @splinetool/runtime fetching remote assets in CI
vi.mock('@lobehub/ui/brand', () => ({
  LogoThree: () => null,
}));

const { chatInputSpy, mockState } = vi.hoisted(() => ({
  chatInputSpy: vi.fn(),
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
  ChatList: ({ itemContent }: { itemContent?: (index: number, id: string) => ReactNode }) => (
    <div data-testid="chat-list">
      {mockState.displayMessages.map((message, index) => (
        <div key={message.id}>{itemContent?.(index, message.id)}</div>
      ))}
    </div>
  ),
  MessageItem: ({ id }: { id: string }) => <div data-testid={`message-item-${id}`}>{id}</div>,
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

describe('AgentOnboardingConversation', () => {
  beforeEach(() => {
    chatInputSpy.mockClear();
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
});
