/**
 * @vitest-environment happy-dom
 */
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ChatList from './ChatList';
import { ConversationProvider } from './ConversationProvider';
import { dataSelectors, useConversationStore } from './store';

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
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid={'welcome'}>{children}</div>
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
  useChatStore: (selector: (state: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agt_old' }),
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

    const mismatchedNextContextSnapshots = snapshots.filter(
      (snapshot) =>
        snapshot.expectedContextKey === messageMapKey(nextContext) &&
        snapshot.actualContextKey !== snapshot.expectedContextKey,
    );

    expect(mismatchedNextContextSnapshots).toEqual([]);
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

  it('renders a settled message list through the virtualized list', () => {
    renderChatList(oldMessages);

    expect(screen.getByTestId('virtualized-list')).toHaveTextContent('msg_old');
  });
});
