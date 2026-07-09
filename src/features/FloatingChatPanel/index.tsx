'use client';

import { type UIChatMessage } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { FloatingSheet, type FloatingSheetProps } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ActionsBarConfig,
  type ConversationHooks,
  ConversationProvider,
} from '@/features/Conversation';
import { useChatFollowUp } from '@/features/Conversation/hooks/useChatFollowUp';
import { type ConversationContext } from '@/features/Conversation/types';
import { mergeConversationHooks } from '@/features/Conversation/utils/mergeConversationHooks';
import { useOperationState } from '@/hooks/useOperationState';
import { useActionsBarConfig } from '@/routes/(main)/agent/features/Conversation/useActionsBarConfig';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ChatBody from './ChatBody';
import { useSingleInstanceGuard } from './guard';
import InputRow from './InputRow';

const SNAP_POINTS = [320, 800] as const;
const MID_SNAP_POINT = SNAP_POINTS[0];
const MAX_SNAP_POINT = SNAP_POINTS.at(-1)!;

const styles = createStaticStyles(({ css, cssVar }) => ({
  panel: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    align-self: stretch;

    width: 100%;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    transition:
      border-block-start-color 240ms cubic-bezier(0.32, 0.72, 0, 1),
      background 240ms cubic-bezier(0.32, 0.72, 0, 1);

    &[data-collapsed='true'] {
      border-block-start-color: transparent;
      background: transparent;
    }
  `,
  sheetSeamless: css`
    border: none;
    border-radius: 0;
    box-shadow: none;
  `,
  titleSpacer: css`
    flex: 1;
  `,
}));

export interface FloatingChatPanelProps {
  /**
   * Override the actions bar config. When omitted, defaults to the shared
   * `useActionsBarConfig()` hook for parity with the main agent page.
   */
  actionsBar?: ActionsBarConfig;
  activeSnapPoint?: number;
  /**
   * Agent document row id (`agent_documents.id`) for the document the user is
   * viewing. When supplied, the active document is injected with
   * `agent_document_id` so LLM tool calls (`readDocument` / `modifyNodes`) can
   * use it directly without a `listDocuments` reverse lookup.
   */
  agentDocumentId?: string;
  agentId: string;
  className?: string;
  dismissible?: boolean;
  /**
   * Active document id for the conversation context. Passed through so the
   * `ActiveTopicDocumentContextInjector` can tell the LLM which agent document
   * the user is currently viewing (e.g. when opened from a document preview
   * portal). Omit when no document is in focus.
   */
  documentId?: string;
  headerActions?: ReactNode;
  /**
   * Conversation lifecycle hooks. Forwarded into the internal
   * `ConversationProvider`. The panel wraps `onAfterSendMessage` to auto-expand
   * the sheet to its tallest snap point on send.
   */
  hooks?: ConversationHooks;
  maxHeight?: number;
  minHeight?: number;
  mode?: 'embedded' | 'overlay';
  onOpenChange?: (open: boolean) => void;
  onSnapPointChange?: (point: number) => void;
  open?: boolean;
  snapPoints?: number[];
  title?: ReactNode;
  /**
   * Topic identifier. Must be the doc-anchored topic resolved through
   * `useDocumentChatTopic` so the panel renders the conversation tied to the
   * `(documentId, agentId)` pair instead of whatever topic happens to be
   * active. Callers should gate on a non-null value before rendering.
   */
  topicId: string;
  variant?: 'elevated' | 'embedded';
  width?: number | string;
}

/**
 * FloatingChatPanel
 *
 * Reusable floating conversation panel — composes `ChatList` + `ChatInput`
 * inside a `FloatingSheet`. The conversation is always main-scope on the
 * supplied `topicId`; `ConversationProvider` owns message loading.
 *
 * Single instance per page (see `./guard.ts`).
 */
const FloatingChatPanel = memo<FloatingChatPanelProps>(
  ({
    agentId,
    topicId,
    documentId,
    agentDocumentId,
    actionsBar,
    hooks,

    width = '100%',

    title,
    headerActions,
  }) => {
    useSingleInstanceGuard();
    const { t } = useTranslation('chat');

    const context = useMemo<ConversationContext>(
      () => ({
        agentId,
        ...(agentDocumentId ? { agentDocumentId } : {}),
        ...(documentId ? { documentId } : {}),
        scope: 'main',
        threadId: null,
        topicId,
      }),
      [agentId, agentDocumentId, documentId, topicId],
    );

    const chatKey = useMemo(() => messageMapKey(context), [context]);

    // ConversationProvider runs an isolated message store per panel — read the
    // shared chat store's `dbMessagesMap` for this key and wire the standard
    // `messages` / `onMessagesChange` sync pattern (mirrors `ConversationArea`
    // in the main agent route). Without this loop the lifecycle's
    // `chatStore.replaceMessages` after a send wouldn't propagate back into
    // the panel's local message slice and the UI would stay empty.
    const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
    const replaceMessages = useChatStore((s) => s.replaceMessages);
    const handleMessagesChange = useCallback(
      (next: UIChatMessage[], ctx: ConversationContext) => {
        replaceMessages(next, { context: ctx });
      },
      [replaceMessages],
    );

    const operationState = useOperationState(context);
    const defaultActionsBar = useActionsBarConfig();
    const resolvedActionsBar = actionsBar ?? defaultActionsBar;

    const [isCollapsed, setIsCollapsed] = useState(true);
    const [activeSnapPoint, setActiveSnapPoint] = useState<number>(MID_SNAP_POINT);

    const expand = useCallback(() => {
      setActiveSnapPoint(MID_SNAP_POINT);
      setIsCollapsed(false);
    }, []);

    const collapse = useCallback(() => {
      setIsCollapsed(true);
      setActiveSnapPoint(MID_SNAP_POINT);
    }, []);

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open) collapse();
      },
      [collapse],
    );

    const agentChatConfig = useAgentStore(chatConfigByIdSelectors.getChatConfigById(agentId));
    const chatFollowUpHooks = useChatFollowUp({
      agentChatConfig,
      conversationKey: chatKey,
      topicId,
    });

    const mergedHooks = useMemo<ConversationHooks>(
      () =>
        mergeConversationHooks(
          hooks,
          {
            onBeforeSendMessage: async () => {
              expand();
            },
          },
          chatFollowUpHooks,
        ),
      [hooks, chatFollowUpHooks, expand],
    );

    const collapseAction = (
      <ActionIcon
        data-testid="floating-chat-panel-collapse-button"
        icon={ChevronDown}
        size="small"
        title={t('floatingChatPanel.collapse', { defaultValue: 'Collapse' })}
        onClick={collapse}
      />
    );

    const sheetProps: FloatingSheetProps = {
      activeSnapPoint,
      className: styles.sheetSeamless,
      closeThreshold: 0.5,
      defaultOpen: false,
      dismissible: true,
      headerActions: (
        <>
          {headerActions}
          {collapseAction}
        </>
      ),
      maxHeight: MAX_SNAP_POINT,
      minHeight: MID_SNAP_POINT,
      mode: 'inline',
      onOpenChange: handleOpenChange,
      onSnapPointChange: setActiveSnapPoint,
      open: !isCollapsed,
      restingHeight: MID_SNAP_POINT,
      snapPoints: [...SNAP_POINTS],
      // Always render a title slot — `space-between` on the header pulls the
      // single child (headerActions) to the start otherwise, putting the
      // collapse button on the left.
      title: title ?? <span className={styles.titleSpacer} />,
      variant: 'elevated',
      width,
    };

    return (
      <ConversationProvider
        actionsBar={resolvedActionsBar}
        context={context}
        hasInitMessages={!!messages}
        hooks={mergedHooks}
        messages={messages}
        operationState={operationState}
        onMessagesChange={handleMessagesChange}
      >
        <div
          className={styles.panel}
          data-collapsed={isCollapsed}
          data-testid="floating-chat-panel"
        >
          <FloatingSheet {...sheetProps}>
            <ChatBody />
          </FloatingSheet>
          <InputRow isCollapsed={isCollapsed} onExpand={expand} />
        </div>
      </ConversationProvider>
    );
  },
);

FloatingChatPanel.displayName = 'FloatingChatPanel';

export default FloatingChatPanel;
