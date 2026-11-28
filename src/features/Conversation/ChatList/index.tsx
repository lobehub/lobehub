'use client';

import type { UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';

import AsyncError from '@/components/AsyncError';
import { getMessageListCacheIdentity, isMessageListServerVerified } from '@/services/message/cache';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';
import {
  hasPendingInterventions,
  INTERVENTION_REFRESH_INTERVAL,
} from '@/store/chat/utils/interventionSync';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { authSelectors, labPreferSelectors } from '@/store/user/selectors';

import WideScreenContainer from '../../WideScreenContainer';
import SkeletonList from '../components/SkeletonList';
import MessageItem from '../Messages';
import type { WorkflowExpandLevelDefault } from '../Messages/AssistantGroup/components/WorkflowCollapse';
import { BackgroundRunHintContext } from '../Messages/Contexts/BackgroundRunHintContext';
import { CompressedHistoryInlineContext } from '../Messages/Contexts/CompressedHistoryInlineContext';
import { MessageActionProvider } from '../Messages/Contexts/MessageActionProvider';
import {
  dataSelectors,
  inputSelectors,
  useConversationStore,
  useConversationStoreApi,
} from '../store';
import AgentSignalReceiptList from './components/AgentSignalReceiptList';
import CompressedHistoryGap from './components/CompressedHistoryGap';
import CompressedMemberRow from './components/CompressedMemberRow';
import ConversationContextLoader from './components/ConversationContextLoader';
import PreviewTail from './components/PreviewTail';
import { resolveTopicPreview } from './components/PreviewTail/resolveTopicPreview';
import { usePreviewHandoff } from './components/PreviewTail/usePreviewHandoff';
import { RefreshError } from './components/RefreshError';
import VirtualizedList from './components/VirtualizedList';
import { useAgentSignalReceipts } from './hooks/useAgentSignalReceipts';
import { useDeepLinkBranchActivation } from './hooks/useDeepLinkBranchActivation';
import { useDeepLinkHistoryBackfill } from './hooks/useDeepLinkHistoryBackfill';
import { useForwardPagingFallback } from './hooks/useForwardPagingFallback';
import { useInitialRevalidation } from './hooks/useInitialRevalidation';
import { useMessageRefreshError } from './hooks/useMessageRefreshError';
import { type InitialScrollPosition } from './hooks/useTopicScrollPersist';
import { resolveMessageListFeedback } from './resolveMessageListFeedback';
import { buildChatRows } from './utils/chatRows';
import { hoistCompressedGroups } from './utils/compressedGroupOrder';
import { expandCompressedRows } from './utils/compressedHistory';
import { keepRowInPlace } from './utils/keepRowInPlace';
import type { MessageDeepLink } from './utils/messageDeepLink';
import { resolveMessageDeepLink } from './utils/messageDeepLink';
import { resolveRefreshingRowId } from './utils/refreshingRow';

const MessageAuthorConfigLoader = memo<{ agentId: string; isLogin: boolean | undefined }>(
  ({ agentId, isLogin }) => {
    const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
    useFetchAgentConfig(isLogin, agentId);
    return null;
  },
);

MessageAuthorConfigLoader.displayName = 'MessageAuthorConfigLoader';

export interface ChatListProps {
  /**
   * Default expand level for assistant workflow (tool-call) groups. When set,
   * pins the initial/reset state and overrides the built-in defaults
   * (streaming `semi`, completion `collapsed`). Users can still toggle locally.
   * - 'collapsed': show summary only
   * - 'semi': constrained scrollable tool list
   * - 'full': all tool details expanded
   * Pass an object (e.g. `{ completion: 'full' }`) to override only one phase.
   * Only applies to the default item renderer; ignored when `itemContent` is supplied.
   */
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  /**
   * Disable the actions bar for all messages (e.g., in share page)
   */
  disableActionsBar?: boolean;
  /**
   * Optional visibility filter applied to the rendered list only. Data flows
   * (fetch cache, AI context assembly, message counts) are untouched — used
   * e.g. by the thread portal to collapse inherited main-chat history down to
   * the fork message.
   */
  filterItem?: (message: UIChatMessage) => boolean;
  /**
   * Optional content rendered as the last item inside the virtualized list —
   * scrolls with the messages instead of being pinned to the viewport bottom.
   * Used e.g. for the SubAgent read-only hint after the last message.
   */
  footerSlot?: ReactNode;
  /**
   * Optional content rendered as the first item inside the virtualized list.
   * It scrolls with messages and does not participate in conversation state.
   */
  headerSlot?: ReactNode;
  /**
   * Hide the "task keeps running on the server, you can leave" loading copy and
   * show the plain dot loader instead (e.g. on external visitor surfaces).
   */
  hideBackgroundRunHint?: boolean;
  /**
   * Where the conversation opens: the saved position or the end (`bottom`,
   * default), or always the first message (`top`, e.g. in share page).
   */
  initialScrollPosition?: InitialScrollPosition;
  /**
   * Custom item renderer. If not provided, uses default ChatItem.
   */
  itemContent?: (index: number, id: string) => ReactNode;
  /** Message hash target to locate after the virtual list has rendered. */
  messageDeepLink?: MessageDeepLink;
  /**
   * The conversation reads forward (`messageReadMode: 'forward'`) but the
   * server cannot page forward. The owner of the context should switch it back
   * to the newest-first read.
   */
  onForwardPagingUnsupported?: () => void;
  /**
   * Print the loaded transcript, without the app chrome, when the page prints.
   * Opt in on the page's main conversation only: a side panel (thread portal,
   * copilot, floating chat) must not replace what its host page prints.
   */
  printable?: boolean;
  /**
   * Reopen the conversation where the reader stopped last time (e.g. a shared
   * topic), paging in history until that message is loaded. Ignored while a
   * message deep link is present.
   */
  rememberReadingPosition?: boolean;
  /**
   * Force showing welcome component even when messages exist
   */
  showWelcome?: boolean;
  /**
   * Welcome component to display when there are no messages
   */
  welcome?: ReactNode;
}
/**
 * ChatList component for Conversation
 *
 * Uses ConversationStore for message data and fetching.
 */
const ChatListContent = memo<ChatListProps>(
  ({
    defaultWorkflowExpandLevel,
    disableActionsBar,
    filterItem,
    footerSlot,
    headerSlot,
    hideBackgroundRunHint,
    initialScrollPosition,
    welcome,
    itemContent,
    messageDeepLink,
    onForwardPagingUnsupported,
    printable,
    rememberReadingPosition,
    showWelcome,
  }) => {
    // The chat store owns the transcript; this view keeps its sync mounted.
    const context = useConversationStore((s) => s.context);
    const paging = context.messageReadMode === 'forward' ? 'forward' : 'backward';
    const skipFetch = useConversationStore(dataSelectors.skipFetch);
    const useFetchMessages = useChatStore((s) => s.useFetchMessages);
    const activeAgentId = useChatStore((s) => s.activeAgentId);
    // Pending cards still refresh during streaming; the data slice merges only
    // intervention changes so lagging DB snapshots cannot replace live text.
    const isStreaming = useChatStore(operationSelectors.isAgentRuntimeRunningByContext(context));
    const hasPendingApproval = useConversationStore((s) => hasPendingInterventions(s.dbMessages));
    // A client-minted topic whose server row does not exist yet (first-send
    // window) must not be fetched: the query would legitimately return an empty
    // list and `onData` would wipe the optimistic messages already on screen.
    // Cleared when the server confirms the topic (`replaceTopicId`), at which
    // point fetching resumes as normal.
    const isCreatingTopic = useChatStore(
      (s) => !!context.topicId && s.creatingTopicIds.includes(context.topicId),
    );
    const enableSelfLearning = useUserStore(labPreferSelectors.enableSelfLearning);
    const messagesSWR = useFetchMessages(context, {
      refreshInterval: hasPendingApproval ? INTERVENTION_REFRESH_INTERVAL : 0,
      revalidateOnFocus: hasPendingApproval || !isStreaming,
      skipFetch: skipFetch || isCreatingTopic,
      syncInterventions: true,
    });
    const laterMessagesError = useConversationStore((s) => s.laterMessagesError);
    const isFallingBack = useForwardPagingFallback({
      errors: [messagesSWR.error, laterMessagesError],
      onUnsupported: onForwardPagingUnsupported,
      paging,
    });
    const messageListIdentity = getMessageListCacheIdentity(context);
    const refreshError = useMessageRefreshError({
      error: isFallingBack ? undefined : messagesSWR.error,
      identity: messageListIdentity,
      isValidating: messagesSWR.isValidating,
      mutate: messagesSWR.mutate,
    });
    const isServerVerified = useCallback(() => isMessageListServerVerified(context), [context]);
    const isInitialRevalidation = useInitialRevalidation({
      identity: messageListIdentity,
      isServerVerified,
      isValidating: messagesSWR.isValidating,
    });
    const allDisplayMessages = useConversationStore(dataSelectors.displayMessages);
    // A compression group summarises the history before the turn that triggered
    // it, so it belongs above that turn's question rather than between the
    // question and its answer.
    const orderedMessages = useMemo(
      () => hoistCompressedGroups(allDisplayMessages),
      [allDisplayMessages],
    );
    const displayMessages = useMemo(
      () => (filterItem ? orderedMessages.filter(filterItem) : orderedMessages),
      [orderedMessages, filterItem],
    );
    const displayMessageIds = useMemo(() => displayMessages.map((m) => m.id), [displayMessages]);
    const compressedHistoryPages = useConversationStore((s) => s.compressedHistoryPages);
    // Share views cannot page a group's older members (owner-only endpoint).
    const canPageCompressedHistory = !context.agentShareId && !context.topicShareId;
    // A compression group's original conversation unfolds into rows above the
    // group on every surface; this list renders those rows itself. Steered
    // follow-up turns fold into the turn they interrupted only for the default
    // renderer: custom ones render each message on its own.
    const expandedRows = useMemo(
      () =>
        expandCompressedRows(
          itemContent
            ? displayMessages.map((message) => ({ id: message.id }))
            : buildChatRows(displayMessages),
          displayMessages,
          compressedHistoryPages,
          { pageable: canPageCompressedHistory },
        ),
      [canPageCompressedHistory, compressedHistoryPages, displayMessages, itemContent],
    );
    const rows = expandedRows.rows;
    const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
    const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
    const resolvedMessageDeepLink = useMemo(
      () => resolveMessageDeepLink(expandedRows.messages, rowIds, messageDeepLink),
      [expandedRows, messageDeepLink, rowIds],
    );
    const resolveMessageRow = useCallback(
      (messageId: string) =>
        resolveMessageDeepLink(expandedRows.messages, rowIds, {
          id: messageId,
          navigationKey: messageId,
        })?.index ?? -1,
      [expandedRows, rowIds],
    );
    const storeApi = useConversationStoreApi();
    const rowIdsRef = useRef(rowIds);
    useEffect(() => {
      rowIdsRef.current = rowIds;
    });
    // A later group's gap loads members above the row the reader is on.
    const loadCompressedGap = useCallback(
      (groupId: string, anchorId: string | undefined, retry: boolean) => {
        const run = () => storeApi.getState().loadCompressedGroupHistory(groupId, { retry });
        if (!anchorId) return run();
        return keepRowInPlace({
          anchorId,
          getRowIds: () => rowIdsRef.current,
          getScrollMethods: () => storeApi.getState().virtuaScrollMethods,
          // One frame commits the new rows, the next lets virtua lay them out.
          nextRender: () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
          run,
        });
      },
      [storeApi],
    );
    const overlayHeight = useConversationStore(inputSelectors.chatInputOverlayHeight);
    const latestMessageId = displayMessageIds.at(-1);

    // Agent-share visitors are not the owner the receipt APIs scope to.
    const isSharePage = !!context.topicShareId || !!context.agentShareId;
    // TODO: Migrate Agent Signal receipts behind a dedicated user-visible receipt capability.
    const canShowAgentSignalReceipts = enableSelfLearning && !isSharePage;
    const { receiptsByAnchor } = useAgentSignalReceipts({
      agentId: canShowAgentSignalReceipts ? activeAgentId : undefined,
      displayMessages,
      enabled: canShowAgentSignalReceipts,
      pollingSignal: latestMessageId,
      topicId: canShowAgentSignalReceipts ? context.topicId : undefined,
    });

    const isLogin = useUserStore(authSelectors.isLogin);
    const isAgentShareVisitor = !!context.agentShareId;
    const messageAuthorAgentIds = useMemo(
      () =>
        [...new Set(displayMessages.map((message) => message.agentId).filter(Boolean))].filter(
          (agentId) => agentId !== context.agentId,
        ) as string[],
      [context.agentId, displayMessages],
    );

    // Use selectors for data

    const defaultItemContent = useCallback(
      (index: number, id: string) => {
        const isLatestItem = rowIds.length === index + 1;
        const row = rowById.get(id);
        const anchoredReceipts = receiptsByAnchor.get(id) ?? [];
        const receiptRender =
          anchoredReceipts.length > 0 ? (
            <AgentSignalReceiptList receipts={anchoredReceipts} />
          ) : undefined;

        return (
          <MessageItem
            continuations={row?.continuations}
            defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
            footerRender={receiptRender}
            id={id}
            index={index}
            isLatestItem={isLatestItem}
          />
        );
      },
      [rowIds, rowById, defaultWorkflowExpandLevel, receiptsByAnchor],
    );
    // Compressed-history rows are this list's own, whichever renderer draws the
    // messages: custom renderers only know message ids.
    const renderItem = useCallback(
      (index: number, id: string) => {
        const row = rowById.get(id);
        if (row?.compressedMember) return <CompressedMemberRow id={id} index={index} />;
        if (row?.compressedGap)
          return (
            <CompressedHistoryGap
              anchorId={rowIds[index + 1]}
              groupId={row.compressedGap}
              onLoad={loadCompressedGap}
            />
          );

        return (itemContent ?? defaultItemContent)(index, id);
      },
      [defaultItemContent, itemContent, loadCompressedGap, rowById, rowIds],
    );
    const messagesInit = useConversationStore(dataSelectors.messagesInit);
    const dbMessages = useConversationStore(dataSelectors.dbMessages);
    const loadEarlierMessages = useConversationStore((s) => s.loadEarlierMessages);
    const switchMessageBranch = useConversationStore((s) => s.switchMessageBranch);
    const deepLinkTargetLoaded = useDeepLinkBranchActivation({
      deepLink: messageDeepLink,
      messages: dbMessages,
      resolved: !!resolvedMessageDeepLink,
      switchMessageBranch,
    });
    useDeepLinkHistoryBackfill({
      deepLinkKey: messageDeepLink?.navigationKey,
      loadedCount: dbMessages.length,
      loadPage: loadEarlierMessages,
      ready: messagesInit && paging === 'backward',
      resolved: !!resolvedMessageDeepLink || deepLinkTargetLoaded,
    });

    // When topicId is null (new conversation), show welcome directly without waiting for fetch
    // because there's no server data to fetch - only local optimistic updates exist
    const isNewConversation = !context.topicId;
    const feedback = resolveMessageListFeedback({
      error: refreshError.error,
      isInitialRevalidation,
      isNewConversation,
      isStreaming,
      messagesInit,
    });

    const activeTopic = useChatStore((s) =>
      context.topicId ? topicSelectors.getTopicById(context.topicId)(s) : undefined,
    );
    const topicPreview = useMemo(
      () =>
        feedback.showSkeleton
          ? resolveTopicPreview({
              contextKey: messageMapKey(context),
              running:
                isStreaming ||
                activeTopic?.status === 'running' ||
                activeTopic?.status === 'waitingForHuman',
              topicId: context.topicId,
              topicUpdatedAt: activeTopic?.updatedAt,
            })
          : undefined,
      [activeTopic, context, feedback.showSkeleton, isStreaming],
    );
    const listRef = useRef<HTMLDivElement>(null);
    const handoffPreview = usePreviewHandoff({
      contextKey: messageMapKey(context),
      listMounted: !topicPreview && !feedback.showSkeleton && !feedback.showFirstLoadError,
      listRef,
      preview: topicPreview,
    });

    // The hint renders inside the latest assistant row, which subscribes to the
    // store itself (virtua would not repaint a cached row from a prop change).
    // Resolved against the rows actually rendered: folded steer chains in the
    // default list, flat (and possibly filtered) messages for custom renderers.
    const refreshingRowId = useMemo(
      () =>
        feedback.showRefreshing ? resolveRefreshingRowId(displayMessages, !itemContent) : undefined,
      [displayMessages, feedback.showRefreshing, itemContent],
    );
    useEffect(() => {
      storeApi.setState({ refreshingRowId });
    }, [refreshingRowId, storeApi]);

    // `messagesInit` is the settled-data signal: [] is a valid loaded result.
    // A first-load failure owns the whole surface, while a background failure
    // must preserve either the messages or the welcome state below.
    if (feedback.showFirstLoadError) {
      return (
        <AsyncError
          error={refreshError.error}
          retrying={refreshError.isRetrying}
          variant={'page'}
          onRetry={refreshError.retry}
        />
      );
    }

    if (topicPreview) {
      return (
        <PreviewTail headerSlot={headerSlot} overlayHeight={overlayHeight} preview={topicPreview} />
      );
    }

    if (feedback.showSkeleton) {
      // The header is chrome, not async content: dropping it here blanks a
      // server-rendered title the moment the list mounts to fetch.
      return (
        <Flexbox height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
          {headerSlot && <WideScreenContainer>{headerSlot}</WideScreenContainer>}
          <SkeletonList />
        </Flexbox>
      );
    }

    const content =
      (showWelcome || displayMessageIds.length === 0) && welcome ? (
        <WideScreenContainer
          style={{
            boxSizing: 'border-box',
            height: '100%',
            paddingBottom: overlayHeight > 0 ? overlayHeight + 12 : undefined,
          }}
          wrapperStyle={{
            minHeight: '100%',
            overflowY: 'auto',
          }}
        >
          {welcome}
        </WideScreenContainer>
      ) : (
        <MessageActionProvider withSingletonActionsBar={!disableActionsBar}>
          <BackgroundRunHintContext value={!hideBackgroundRunHint}>
            <CompressedHistoryInlineContext value>
              <VirtualizedList
                dataSource={rowIds}
                footerSlot={footerSlot}
                headerSlot={headerSlot}
                initialScrollPosition={initialScrollPosition}
                itemContent={renderItem}
                messageDeepLink={resolvedMessageDeepLink}
                paging={paging}
                printable={printable}
                rememberReadingPosition={rememberReadingPosition}
                resolveMessageRow={resolveMessageRow}
              />
            </CompressedHistoryInlineContext>
          </BackgroundRunHintContext>
        </MessageActionProvider>
      );

    return (
      <Flexbox style={{ height: '100%', minHeight: 0, position: 'relative' }}>
        {messageAuthorAgentIds.map((agentId) => (
          <MessageAuthorConfigLoader
            agentId={agentId}
            isLogin={isLogin && !isAgentShareVisitor}
            key={agentId}
          />
        ))}
        <Flexbox
          flex={1}
          ref={listRef}
          style={{ minHeight: 0, visibility: handoffPreview ? 'hidden' : undefined }}
        >
          {content}
        </Flexbox>
        {handoffPreview && (
          <div style={{ inset: 0, position: 'absolute' }}>
            <PreviewTail
              headerSlot={headerSlot}
              overlayHeight={overlayHeight}
              preview={handoffPreview}
            />
          </div>
        )}
        {feedback.showBackgroundError && (
          <RefreshError
            error={refreshError.error}
            retrying={refreshError.isRetrying}
            onRetry={refreshError.retry}
          />
        )}
      </Flexbox>
    );
  },
);

ChatListContent.displayName = 'ConversationChatListContent';

const ChatList = memo<ChatListProps>((props) => (
  <>
    <ConversationContextLoader />
    <ChatListContent {...props} />
  </>
));

ChatList.displayName = 'ConversationChatList';

export default ChatList;
