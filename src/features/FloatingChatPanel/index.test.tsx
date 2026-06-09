import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetFloatingChatPanelRegistry } from './guard';
import FloatingChatPanel from './index';

vi.mock('./ChatBody', () => ({
  default: () => <div data-testid="chat-body">body</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  FloatingSheet: ({
    children,
    dismissible,
    headerActions,
    snapPoints,
    title,
    variant,
  }: {
    children: ReactNode;
    dismissible?: boolean;
    headerActions?: ReactNode;
    snapPoints?: number[];
    title?: ReactNode;
    variant?: string;
  }) => (
    <div
      data-dismissible={String(dismissible)}
      data-snap-points={JSON.stringify(snapPoints ?? [])}
      data-testid="floating-panel-shell"
      data-variant={variant ?? ''}
    >
      <div data-testid="sheet-title">{title}</div>
      <div data-testid="sheet-actions">{headerActions}</div>
      {children}
    </div>
  ),
}));

vi.mock('@/features/Conversation', () => ({
  ChatList: () => null,
  ConversationProvider: ({ children, context }: any) => (
    <div data-context={JSON.stringify(context)} data-testid="provider">
      {children}
    </div>
  ),
}));

vi.mock('@/routes/(main)/agent/features/Conversation/useActionsBarConfig', () => ({
  useActionsBarConfig: () => ({ assistant: {}, user: {} }),
}));

vi.mock('@/hooks/useOperationState', () => ({
  useOperationState: () => undefined,
}));

const mockChatState = vi.hoisted(() => ({
  current: {
    dbMessagesMap: {} as Record<string, Array<{ id: string; threadId?: string | null }>>,
    portalThreadId: undefined as string | undefined,
    replaceMessages: vi.fn(),
  },
}));

vi.mock('@/store/chat', () => {
  const useChatStore: any = (selector: any) => selector(mockChatState.current);
  useChatStore.getState = () => mockChatState.current;
  useChatStore.setState = (patch: any) => {
    Object.assign(
      mockChatState.current,
      typeof patch === 'function' ? patch(mockChatState.current) : patch,
    );
  };
  return { useChatStore };
});

vi.mock('@/store/chat/utils/messageMapKey', () => ({
  messageMapKey: (ctx: any) => `${ctx.agentId}:${ctx.topicId}:${ctx.threadId}`,
}));

describe('FloatingChatPanel', () => {
  beforeEach(() => {
    __resetFloatingChatPanelRegistry();
    mockChatState.current.dbMessagesMap = {};
    mockChatState.current.portalThreadId = undefined;
  });

  it('builds an ephemeral thread context by default from agentId + topicId', () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="agent-1" topicId="topic-1" />);
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx).toEqual({
      agentId: 'agent-1',
      isNew: true,
      scope: 'thread',
      threadId: null,
      topicId: 'topic-1',
    });
  });

  it('drops isNew when an existing threadId is supplied', () => {
    const { getByTestId } = render(
      <FloatingChatPanel agentId="agent-1" threadId="thread-1" topicId="topic-1" />,
    );
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx).toEqual({
      agentId: 'agent-1',
      scope: 'thread',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
  });

  it('builds a main-scope context when scope is forced to main', () => {
    const { getByTestId } = render(
      <FloatingChatPanel agentId="agent-1" scope="main" topicId="topic-1" />,
    );
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx).toEqual({
      agentId: 'agent-1',
      scope: 'main',
      threadId: null,
      topicId: 'topic-1',
    });
  });

  it('anchors a new thread on the topic last main message when one is present', () => {
    mockChatState.current.dbMessagesMap = {
      // mocked messageMapKey: `${agentId}:${topicId}:${threadId}`; main scope
      // omits threadId so it serializes as "agent-1:topic-1:undefined".
      'agent-1:topic-1:undefined': [
        { id: 'msg-1', threadId: null },
        { id: 'msg-2', threadId: null },
      ],
    };

    const { getByTestId } = render(<FloatingChatPanel agentId="agent-1" topicId="topic-1" />);
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx).toEqual({
      agentId: 'agent-1',
      isNew: true,
      scope: 'thread',
      sourceMessageId: 'msg-2',
      threadId: null,
      threadType: 'standalone',
      topicId: 'topic-1',
    });
  });

  it('skips thread-scoped rows when picking the source message anchor', () => {
    mockChatState.current.dbMessagesMap = {
      'agent-1:topic-1:undefined': [
        { id: 'msg-1', threadId: null },
        { id: 'msg-2', threadId: null },
        { id: 'msg-3', threadId: 'thread-x' },
      ],
    };

    const { getByTestId } = render(<FloatingChatPanel agentId="agent-1" topicId="topic-1" />);
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx.sourceMessageId).toBe('msg-2');
  });

  it('forwards documentId into the conversation context for document-aware injection', () => {
    const { getByTestId } = render(
      <FloatingChatPanel agentId="agent-1" documentId="doc-1" topicId="topic-1" />,
    );
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx).toEqual({
      agentId: 'agent-1',
      documentId: 'doc-1',
      isNew: true,
      scope: 'thread',
      threadId: null,
      topicId: 'topic-1',
    });
  });

  it('forwards title and headerActions to floating panel header', () => {
    const { getByTestId } = render(
      <FloatingChatPanel
        agentId="a"
        headerActions={<button>Action</button>}
        title={<span>My Title</span>}
        topicId="t"
      />,
    );
    expect(getByTestId('sheet-title').textContent).toBe('My Title');
    expect(getByTestId('sheet-actions').textContent).toBe('Action');
  });

  it('applies default shell props', () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);
    const sheet = getByTestId('floating-panel-shell');
    expect(sheet.dataset.snapPoints).toBe(JSON.stringify([180, 320, 520, 800]));
    expect(sheet.dataset.variant).toBe('embedded');
    expect(sheet.dataset.dismissible).toBe('false');
  });
});
