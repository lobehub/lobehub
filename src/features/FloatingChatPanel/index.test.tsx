import { act, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetFloatingChatPanelRegistry } from './guard';
import FloatingChatPanel from './index';

vi.mock('./ChatBody', () => ({
  default: () => <div data-testid="chat-body">body</div>,
}));

const sheetHandlers = vi.hoisted(() => ({
  current: {
    onOpenChange: undefined as ((open: boolean) => void) | undefined,
    onSnapPointChange: undefined as ((point: number) => void) | undefined,
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  FloatingSheet: ({
    children,
    dismissible,
    headerActions,
    open,
    activeSnapPoint,
    snapPoints,
    title,
    variant,
    onOpenChange,
    onSnapPointChange,
  }: {
    activeSnapPoint?: number;
    children: ReactNode;
    dismissible?: boolean;
    headerActions?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    onSnapPointChange?: (point: number) => void;
    open?: boolean;
    snapPoints?: number[];
    title?: ReactNode;
    variant?: string;
  }) => {
    sheetHandlers.current.onOpenChange = onOpenChange;
    sheetHandlers.current.onSnapPointChange = onSnapPointChange;
    return (
      <div
        data-active-snap={activeSnapPoint}
        data-dismissible={String(dismissible)}
        data-open={String(open)}
        data-snap-points={JSON.stringify(snapPoints ?? [])}
        data-testid="floating-panel-shell"
        data-variant={variant ?? ''}
      >
        <div data-testid="sheet-title">{title}</div>
        <div data-testid="sheet-actions">{headerActions}</div>
        {children}
      </div>
    );
  },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    onClick,
    title,
    ...rest
  }: {
    onClick?: () => void;
    title?: string;
    [key: string]: unknown;
  }) => (
    <button
      data-testid={(rest as any)['data-testid']}
      title={title}
      type="button"
      onClick={onClick}
    >
      {title}
    </button>
  ),
  Icon: ({ icon }: { icon: () => void }) => <span data-icon={icon.name} />,
}));

const mergedHooksCaptured = vi.hoisted(() => ({
  current: undefined as undefined | { onBeforeSendMessage?: () => Promise<void> },
}));

vi.mock('@/features/Conversation', () => ({
  ChatInput: ({
    allowExpand,
    compact,
    leftActions,
    rightActions,
    showControlBar,
  }: {
    allowExpand?: boolean;
    compact?: boolean;
    leftActions?: string[];
    rightActions?: string[];
    showControlBar?: boolean;
  }) => (
    <div
      data-allow-expand={String(allowExpand ?? true)}
      data-compact={String(compact ?? false)}
      data-left-actions={JSON.stringify(leftActions ?? [])}
      data-right-actions={JSON.stringify(rightActions ?? [])}
      data-show-control-bar={String(showControlBar ?? true)}
      data-testid="chat-input"
    />
  ),
  ChatList: () => null,
  ConversationProvider: ({
    children,
    context,
    hooks,
    skipFetch,
    hasInitMessages,
    messages,
  }: any) => {
    mergedHooksCaptured.current = hooks;
    return (
      <div
        data-context={JSON.stringify(context)}
        data-has-init-messages={String(hasInitMessages ?? false)}
        data-has-messages-prop={String(messages !== undefined)}
        data-skip-fetch={String(skipFetch ?? false)}
        data-testid="provider"
      >
        {children}
      </div>
    );
  },
}));

const mockConversationState = vi.hoisted(() => ({
  current: {
    chatInputOverlayHeight: 0,
  },
}));

vi.mock('@/features/Conversation/store', () => ({
  inputSelectors: {
    chatInputOverlayHeight: (s: { chatInputOverlayHeight: number }) => s.chatInputOverlayHeight,
  },
  useConversationStore: (selector: (s: { chatInputOverlayHeight: number }) => unknown) =>
    selector(mockConversationState.current),
}));

vi.mock('@/routes/(main)/agent/features/Conversation/useActionsBarConfig', () => ({
  useActionsBarConfig: () => ({ assistant: {}, user: {} }),
}));

vi.mock('@/hooks/useOperationState', () => ({
  useOperationState: () => undefined,
}));

vi.mock('@/features/Conversation/hooks/useChatFollowUp', () => ({
  useChatFollowUp: () => ({}),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: () => undefined,
}));

vi.mock('@/store/agent/selectors', () => ({
  chatConfigByIdSelectors: {
    getChatConfigById: () => () => undefined,
  },
}));

vi.mock('@/store/chat/utils/messageMapKey', () => ({
  messageMapKey: (ctx: any) => `${ctx.agentId}:${ctx.topicId}:${ctx.threadId}`,
}));

const mockChatState = vi.hoisted(() => ({
  current: {
    dbMessagesMap: {} as Record<string, Array<{ id: string }>>,
    replaceMessages: vi.fn(),
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector(mockChatState.current),
}));

describe('FloatingChatPanel', () => {
  beforeEach(() => {
    __resetFloatingChatPanelRegistry();
    sheetHandlers.current.onOpenChange = undefined;
    sheetHandlers.current.onSnapPointChange = undefined;
    mergedHooksCaptured.current = undefined;
    mockChatState.current.dbMessagesMap = {};
    mockChatState.current.replaceMessages = vi.fn();
  });

  it('builds a main-scope context anchored on the supplied topicId', () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="agent-1" topicId="topic-1" />);
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx).toEqual({
      agentId: 'agent-1',
      scope: 'main',
      threadId: null,
      topicId: 'topic-1',
    });
  });

  it('forwards documentId / agentDocumentId into the context for document-aware injection', () => {
    const { getByTestId } = render(
      <FloatingChatPanel
        agentDocumentId="agent-doc-1"
        agentId="agent-1"
        documentId="doc-1"
        topicId="topic-1"
      />,
    );
    const ctx = JSON.parse(getByTestId('provider').dataset.context!);
    expect(ctx).toEqual({
      agentDocumentId: 'agent-doc-1',
      agentId: 'agent-1',
      documentId: 'doc-1',
      scope: 'main',
      threadId: null,
      topicId: 'topic-1',
    });
  });

  it('lets ConversationProvider drive the fetch when the chat store has no slice yet', () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="agent-1" topicId="topic-1" />);
    const provider = getByTestId('provider');
    expect(provider.dataset.skipFetch).toBe('false');
    expect(provider.dataset.hasInitMessages).toBe('false');
  });

  it('syncs the chat store slice into ConversationProvider when the topic already has messages', () => {
    mockChatState.current.dbMessagesMap = {
      'agent-1:topic-1:null': [{ id: 'msg-1' }],
    };
    const { getByTestId } = render(<FloatingChatPanel agentId="agent-1" topicId="topic-1" />);
    const provider = getByTestId('provider');
    expect(provider.dataset.hasInitMessages).toBe('true');
    expect(provider.dataset.hasMessagesProp).toBe('true');
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
    expect(getByTestId('sheet-actions').textContent).toContain('Action');
  });

  it('starts collapsed and ships a seamless dismissible sheet with two snap points', () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);
    const sheet = getByTestId('floating-panel-shell');
    expect(sheet.dataset.snapPoints).toBe(JSON.stringify([320, 800]));
    expect(sheet.dataset.variant).toBe('elevated');
    expect(sheet.dataset.dismissible).toBe('true');
    expect(sheet.dataset.open).toBe('false');
    expect(sheet.dataset.activeSnap).toBe('320');
    expect(getByTestId('floating-chat-panel').dataset.collapsed).toBe('true');
  });

  it('renders a minimal ChatInput while collapsed (no left/right actions)', () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);
    const input = getByTestId('chat-input');
    expect(input.dataset.allowExpand).toBe('false');
    expect(input.dataset.leftActions).toBe('[]');
    expect(input.dataset.rightActions).toBe('[]');
  });

  it('expands to the mid snap when the Send hook fires', async () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);
    expect(getByTestId('floating-panel-shell').dataset.open).toBe('false');

    await act(async () => {
      await mergedHooksCaptured.current?.onBeforeSendMessage?.();
    });

    const sheet = getByTestId('floating-panel-shell');
    expect(sheet.dataset.open).toBe('true');
    expect(sheet.dataset.activeSnap).toBe('320');
    expect(getByTestId('floating-chat-panel').dataset.collapsed).toBe('false');
    const input = getByTestId('chat-input');
    expect(input.dataset.allowExpand).toBe('false');
    expect(input.dataset.leftActions).toBe(JSON.stringify(['typo']));
    expect(input.dataset.rightActions).toBe(JSON.stringify(['contextWindow']));
  });

  it('collapses back when the sheet reports onOpenChange(false)', async () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);

    await act(async () => {
      await mergedHooksCaptured.current?.onBeforeSendMessage?.();
    });
    expect(getByTestId('floating-panel-shell').dataset.open).toBe('true');

    act(() => {
      sheetHandlers.current.onOpenChange?.(false);
    });

    expect(getByTestId('floating-panel-shell').dataset.open).toBe('false');
    expect(getByTestId('floating-chat-panel').dataset.collapsed).toBe('true');
    expect(getByTestId('floating-panel-shell').dataset.activeSnap).toBe('320');
  });

  it('expands when the header collapse button is clicked from expanded state', async () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);

    await act(async () => {
      await mergedHooksCaptured.current?.onBeforeSendMessage?.();
    });
    expect(getByTestId('floating-chat-panel').dataset.collapsed).toBe('false');

    fireEvent.click(getByTestId('floating-chat-panel-collapse-button'));
    expect(getByTestId('floating-chat-panel').dataset.collapsed).toBe('true');
  });

  it('expands via the hover bar expand button', () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);
    expect(getByTestId('floating-chat-panel').dataset.collapsed).toBe('true');

    fireEvent.click(getByTestId('floating-chat-panel-expand-button'));
    expect(getByTestId('floating-chat-panel').dataset.collapsed).toBe('false');
    expect(getByTestId('floating-panel-shell').dataset.activeSnap).toBe('320');
  });

  it('reflects user-driven snap changes through onSnapPointChange', async () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);

    await act(async () => {
      await mergedHooksCaptured.current?.onBeforeSendMessage?.();
    });
    expect(getByTestId('floating-panel-shell').dataset.activeSnap).toBe('320');

    act(() => {
      sheetHandlers.current.onSnapPointChange?.(800);
    });
    expect(getByTestId('floating-panel-shell').dataset.activeSnap).toBe('800');
  });

  it('keeps the ChatInput element identity stable across state changes', async () => {
    const { getByTestId } = render(<FloatingChatPanel agentId="a" topicId="t" />);
    const beforeNode = getByTestId('chat-input');

    await act(async () => {
      await mergedHooksCaptured.current?.onBeforeSendMessage?.();
    });
    const afterExpand = getByTestId('chat-input');
    expect(afterExpand).toBe(beforeNode);

    act(() => {
      sheetHandlers.current.onOpenChange?.(false);
    });
    const afterCollapse = getByTestId('chat-input');
    expect(afterCollapse).toBe(beforeNode);
  });
});
