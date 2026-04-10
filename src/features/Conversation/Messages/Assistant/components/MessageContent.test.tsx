import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MessageContent from './MessageContent';

const mockConversationState = {
  addReaction: vi.fn(),
  collapsed: false,
  generating: false,
  reasoning: false,
  removeReaction: vi.fn(),
};

const mockUserState = {
  userId: 'user-1',
};

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mockUserState) => unknown) => selector(mockUserState),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: typeof mockUserState) => state.userId,
  },
}));

vi.mock('../../../store', () => ({
  messageStateSelectors: {
    isMessageCollapsed: () => () => mockConversationState.collapsed,
    isMessageGenerating: () => () => mockConversationState.generating,
    isMessageInReasoning: () => () => mockConversationState.reasoning,
  },
  useConversationStore: (
    selector: (state: {
      addReaction: typeof mockConversationState.addReaction;
      removeReaction: typeof mockConversationState.removeReaction;
    }) => unknown,
  ) =>
    selector({
      addReaction: mockConversationState.addReaction,
      removeReaction: mockConversationState.removeReaction,
    }),
}));

vi.mock('../useMarkdown', () => ({
  useMarkdown: () => ({}),
}));

vi.mock('../../AssistantGroup/Tools', () => ({
  Tools: ({ tools }: { tools: unknown[] }) => (
    <div data-testid="assistant-tools">{tools.length}</div>
  ),
}));

vi.mock('../../components/DisplayContent', () => ({
  default: ({
    content,
    isToolCallGenerating,
  }: {
    content: string;
    isToolCallGenerating?: boolean;
  }) => (
    <div
      data-state={isToolCallGenerating ? 'tool-loading' : content ? 'content' : 'loading'}
      data-testid="display-content"
    />
  ),
}));

vi.mock('../../../components/Reaction', () => ({
  ReactionDisplay: () => null,
}));

vi.mock('../../AssistantGroup/components/CollapsedMessage', () => ({
  CollapsedMessage: ({ content }: { content: string }) => (
    <div data-testid="collapsed-message">{content}</div>
  ),
}));

vi.mock('../../components/FileChunks', () => ({
  default: () => null,
}));

vi.mock('../../components/ImageFileListViewer', () => ({
  default: () => null,
}));

vi.mock('../../components/Reasoning', () => ({
  default: () => null,
}));

vi.mock('../../components/SearchGrounding', () => ({
  default: () => null,
}));

const createMessage = (overrides: Record<string, unknown> = {}) =>
  ({
    content: '',
    createdAt: Date.now(),
    id: 'msg-1',
    role: 'assistant',
    updatedAt: Date.now(),
    ...overrides,
  }) as ComponentProps<typeof MessageContent>;

describe('Assistant MessageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationState.collapsed = false;
    mockConversationState.generating = false;
    mockConversationState.reasoning = false;
  });

  it('should render tool progress when a tool call is running without text content yet', () => {
    mockConversationState.generating = true;

    render(
      <MessageContent
        {...createMessage({
          tools: [{ apiName: 'search', id: 'tool-1', identifier: 'web-browsing' }],
        })}
      />,
    );

    expect(screen.getByTestId('display-content')).toHaveAttribute('data-state', 'tool-loading');
    expect(screen.getByTestId('assistant-tools')).toHaveTextContent('1');
  });

  it('should keep the loading state visible when the tool list is still empty', () => {
    mockConversationState.generating = true;

    render(<MessageContent {...createMessage({ tools: [] })} />);

    expect(screen.getByTestId('display-content')).toHaveAttribute('data-state', 'loading');
    expect(screen.queryByTestId('assistant-tools')).not.toBeInTheDocument();
  });
});
