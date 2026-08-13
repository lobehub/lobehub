/**
 * @vitest-environment happy-dom
 */
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ChatList from './ChatList';
import { ConversationProvider } from './ConversationProvider';
import { dataSelectors, useConversationStore, useConversationStoreApi } from './store';

const chatListMocks = vi.hoisted(() => ({
  isStreaming: false,
  refreshError: {
    error: undefined as unknown,
    isRetrying: false,
    retry: vi.fn(),
  },
  swrMutate: vi.fn(),
  useFetchAgentConfig: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Conversation/ChatList/components/AgentSignalReceiptList', () => ({
  default: () => null,
}));

vi.mock('@/features/Conversation/ChatList/components/VirtualizedList', () => ({
  default: ({ dataSource }: { dataSource: string[] }) => (
    <div data-testid={'virtualized-list'}>{dataSource.join(',')}</div>
  ),
}));

vi.mock('@/features/Conversation/ChatList/hooks/useAgentSignalReceipts', () => ({
  useAgentSignalReceipts: () => ({ receiptsByAnchor: new Map() }),
}));

vi.mock('@/features/Conversation/ChatList/hooks/useMessageRefreshError', () => ({
  useMessageRefreshError: () => chatListMocks.refreshError,
}));

vi.mock('@/features/Conversation/components/SkeletonList', () => ({
  default: () => <div data-testid={'skeleton-list'} />,
}));

vi.mock('@/features/Conversation/Messages', () => ({
  default: ({ id }: { id: string }) => <div>{id}</div>,
}));

vi.mock('@/features/Conversation/Messages/Contexts/MessageActionProvider', () => ({
  MessageActionProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children, style }: { children?: ReactNode; style?: React.CSSProperties }) => (
    <div data-testid={'welcome'} style={style}>
      {children}
    </div>
  ),
}));

vi.mock('@/hooks/useFetchAvailableAgents', () => ({ useFetchAvailableAgents: vi.fn() }));
vi.mock('@/hooks/useFetchMemoryForTopic', () => ({ useFetchTopicMemories: vi.fn() }));
vi.mock('@/hooks/useFetchNotebookDocuments', () => ({ useFetchNotebookDocuments: vi.fn() }));

vi.mock('@/libs/swr', () => ({
  useClientDataSWRWithSync: () => ({
    data: undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: chatListMocks.swrMutate,
  }),
}));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'user-1:personal',
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (
    selector: (state: { useFetchAgentConfig: typeof chatListMocks.useFetchAgentConfig }) => unknown,
  ) => selector({ useFetchAgentConfig: chatListMocks.useFetchAgentConfig }),
}));

vi.mock('@/store/chat', () => ({
  getChatStoreState: () => ({}),
  useChatStore: (
    selector: (state: { activeAgentId: string; creatingTopicIds: string[] }) => unknown,
  ) => selector({ activeAgentId: 'agt_old', creatingTopicIds: [] }),
}));

vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    isAgentRuntimeRunningByContext: () => () => chatListMocks.isStreaming,
  },
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: vi.fn(),
  useServerConfigStore: () => ({ enableAgentSelfIteration: false }),
}));

vi.mock('@/store/user', () => ({ useUserStore: () => false }));
vi.mock('@/store/user/selectors', () => ({ authSelectors: {}, settingsSelectors: {} }));

const oldContext = {
  agentId: 'agt_old',
  threadId: null,
  topicId: 'tpc_old',
} satisfies ConversationContext;

const nextContext = {
  agentId: 'agt_next',
  threadId: null,
  topicId: null,
} satisfies ConversationContext;

const oldMessages = [
  {
    content: 'old message',
    createdAt: 1,
    id: 'msg_old',
    role: 'user',
    updatedAt: 1,
  },
] as UIChatMessage[];

interface Snapshot {
  actualContextKey: string;
  displayMessageIds: string[];
  expectedContextKey: string;
}

const Probe = ({
  expectedContext,
  snapshots,
}: {
  expectedContext: ConversationContext;
  snapshots: Snapshot[];
}) => {
  const context = useConversationStore((s) => s.context);
  const displayMessageIds = useConversationStore(dataSelectors.displayMessageIds);

  snapshots.push({
    actualContextKey: messageMapKey(context),
    displayMessageIds,
    expectedContextKey: messageMapKey(expectedContext),
  });

  return null;
};

const OverlayHeightSetter = () => {
  const setChatInputOverlayHeight = useConversationStore((s) => s.setChatInputOverlayHeight);

  return <button onClick={() => setChatInputOverlayHeight(48)}>set overlay height</button>;
};

const renderChatList = (messages?: UIChatMessage[]) =>
  render(
    <ConversationProvider
      context={oldContext}
      hasInitMessages={messages !== undefined}
      messages={messages}
    >
      <ChatList welcome={<div>WELCOME</div>} />
    </ConversationProvider>,
  );

describe('ConversationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatListMocks.isStreaming = false;
    chatListMocks.refreshError.error = undefined;
    chatListMocks.refreshError.isRetrying = false;
  });

  it('keeps the same store instance across context changes', () => {
    const apis: unknown[] = [];
    const ApiProbe = () => {
      apis.push(useConversationStoreApi());
      return null;
    };

    const { rerender } = render(
      <ConversationProvider hasInitMessages context={oldContext} messages={oldMessages}>
        <ApiProbe />
      </ConversationProvider>,
    );

    rerender(
      <ConversationProvider context={nextContext} hasInitMessages={false}>
        <ApiProbe />
      </ConversationProvider>,
    );

    expect(new Set(apis).size).toBe(1);
  });

  it('resets conversation-ephemeral state in place while preserving infra fields', () => {
    let api: ReturnType<typeof useConversationStoreApi> | undefined;
    const ApiCapture = () => {
      api = useConversationStoreApi();
      return null;
    };

    const { rerender } = render(
      <ConversationProvider hasInitMessages context={oldContext} messages={oldMessages}>
        <ApiCapture />
      </ConversationProvider>,
    );

    const fakeEditor = { focus: vi.fn() };
    const fakeScrollMethods = {
      getItemOffset: vi.fn(),
      getItemSize: vi.fn(),
      getScrollOffset: vi.fn(),
      getScrollSize: vi.fn(),
      getTotalCount: vi.fn(),
      getViewportSize: vi.fn(),
      scrollTo: vi.fn(),
      scrollToIndex: vi.fn(),
    };

    act(() => {
      api!.setState({
        activeIndex: 3,
        atBottom: false,
        chatInputOverlayHeight: 48,
        editor: fakeEditor,
        heteroOverloadRetryAttempts: { msg_old: 2 },
        heteroOverloadWaitOpIds: { msg_old: 'op_1' },
        inputMessage: 'unsent draft',
        isScrolling: true,
        messageEditingIds: ['msg_old'],
        messageLoadingIds: ['msg_old'],
        scheduledSendAt: '2026-08-07T10:00:00.000Z',
        selectedMessageIds: ['msg_old'],
        selectionAnchorId: 'msg_old',
        selectionMode: true,
        virtuaScrollMethods: fakeScrollMethods,
        visibleItems: new Map([[0, { bottom: 1, ratio: 1, top: 0 }]]),
      });
    });

    rerender(
      <ConversationProvider context={nextContext} hasInitMessages={false}>
        <ApiCapture />
      </ConversationProvider>,
    );

    const state = api!.getState();

    expect(state.selectionMode).toBe(false);
    expect(state.selectedMessageIds).toEqual([]);
    expect(state.selectionAnchorId).toBeUndefined();
    expect(state.messageEditingIds).toEqual([]);
    expect(state.messageLoadingIds).toEqual([]);
    expect(state.heteroOverloadRetryAttempts).toEqual({});
    expect(state.heteroOverloadWaitOpIds).toEqual({});
    expect(state.inputMessage).toBe('');
    expect(state.scheduledSendAt).toBeUndefined();
    expect(state.activeIndex).toBeNull();
    expect(state.atBottom).toBe(true);
    expect(state.isScrolling).toBe(false);
    expect(state.visibleItems.size).toBe(0);

    expect(state.editor).toBe(fakeEditor);
    expect(state.virtuaScrollMethods).toBe(fakeScrollMethods);
    expect(state.chatInputOverlayHeight).toBe(48);
  });

  it('does not expose the previous local conversation store after context changes', () => {
    const snapshots: Snapshot[] = [];

    const { rerender } = render(
      <ConversationProvider hasInitMessages context={oldContext} messages={oldMessages}>
        <Probe expectedContext={oldContext} snapshots={snapshots} />
      </ConversationProvider>,
    );

    rerender(
      <ConversationProvider context={nextContext} hasInitMessages={false}>
        <Probe expectedContext={nextContext} snapshots={snapshots} />
      </ConversationProvider>,
    );

    // The in-place reset lands in a layout effect, so one intermediate commit
    // renders with the new context props against the old store state. React
    // flushes the resulting store update synchronously before paint — what must
    // hold is that the *final* (painted) frame is fully consistent.
    const lastSnapshot = snapshots.at(-1)!;
    expect(lastSnapshot.expectedContextKey).toBe(messageMapKey(nextContext));
    expect(lastSnapshot.actualContextKey).toBe(messageMapKey(nextContext));
    expect(lastSnapshot.displayMessageIds).toEqual([]);
  });

  it('renders the message skeleton before the first request settles', () => {
    renderChatList();

    expect(screen.getByTestId('skeleton-list')).toBeInTheDocument();
  });

  it('renders a retryable full-surface error when the first request fails', () => {
    chatListMocks.refreshError.error = new Error('offline');

    renderChatList();
    fireEvent.click(screen.getByRole('button', { name: 'error.retry' }));

    expect(chatListMocks.refreshError.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('skeleton-list')).not.toBeInTheDocument();
  });

  it('preserves a settled empty welcome while showing a retryable background error', () => {
    chatListMocks.refreshError.error = new Error('offline');

    renderChatList([]);
    fireEvent.click(screen.getByRole('button', { name: 'error.retry' }));

    expect(screen.getByText('WELCOME')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(chatListMocks.refreshError.retry).toHaveBeenCalledTimes(1);
  });

  it('reserves composer overlay space in the settled empty welcome', () => {
    const { container } = render(
      <ConversationProvider hasInitMessages context={oldContext} messages={[]}>
        <ChatList welcome={<div>WELCOME</div>} />
        <OverlayHeightSetter />
      </ConversationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'set overlay height' }));

    expect(container.querySelector('[data-testid="welcome"]')).toHaveStyle({
      boxSizing: 'border-box',
      paddingBottom: '60px',
    });
  });

  it('renders a settled message list through the virtualized list', () => {
    renderChatList(oldMessages);

    expect(screen.getByTestId('virtualized-list')).toHaveTextContent('msg_old');
  });
});
