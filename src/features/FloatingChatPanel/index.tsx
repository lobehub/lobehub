'use client';

import { ActionIcon, FloatingSheet, type FloatingSheetProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import CopilotToolbar from '@/features/PageEditor/Copilot/Toolbar';
import { PageAgentPanelOverrideProvider } from '@/features/PageEditor/RightPanel/OverrideContext';
import { useOperationState } from '@/hooks/useOperationState';
import { useActionsBarConfig } from '@/routes/(main)/agent/features/Conversation/useActionsBarConfig';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ChatBody from './ChatBody';
import { useSingleInstanceGuard } from './guard';
import InputRow from './InputRow';

const SNAP_POINTS = [320, 800] as const;
const MID_SNAP_POINT = SNAP_POINTS[0];
const MAX_SNAP_POINT = SNAP_POINTS.at(-1)!;

const COLLAPSED = "[data-collapsed='true']";

const styles = stylex.create({
  panel: {
    alignSelf: 'stretch',
    backgroundColor: { default: cssVar.colorBgContainer, [COLLAPSED]: 'transparent' },
    backgroundImage: 'none',
    borderBlockStartColor: {
      default: cssVar.colorBorderSecondary,
      [COLLAPSED]: 'transparent',
    },
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    transition:
      'border-block-start-color 240ms cubic-bezier(0.32, 0.72, 0, 1), background 240ms cubic-bezier(0.32, 0.72, 0, 1)',
    width: '100%',
  },
  panelEmbedded: {
    borderBlockStartStyle: 'none',
    flex: '1',
    minHeight: 0,
  },
  sheetSeamless: {
    borderRadius: 0,
    borderStyle: 'none',
    boxShadow: 'none',
  },
  titleSpacer: {
    flex: '1',
  },
});

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
  /** Whether the panel starts expanded. Defaults to collapsed for floating usages. */
  defaultOpen?: boolean;
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
  /** Embedded mode only: collapse the hosting side panel from the toolbar. */
  onCollapse?: () => void;
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
    defaultOpen = false,
    mode = 'overlay',
    onCollapse,

    width = '100%',

    title,
    headerActions,
  }) => {
    useSingleInstanceGuard();
    const { t } = useTranslation('chat');
    const isEmbedded = mode === 'embedded';
    const [embeddedTopicId, setEmbeddedTopicId] = useState<string | null>(topicId);
    const activeTopicId = isEmbedded ? embeddedTopicId : topicId;

    const context = useMemo<ConversationContext>(
      () => ({
        agentId,
        ...(agentDocumentId ? { agentDocumentId } : {}),
        ...(documentId ? { documentId } : {}),
        ...(isEmbedded ? { isolatedTopic: true } : {}),
        scope: 'main',
        threadId: null,
        topicId: activeTopicId,
      }),
      [activeTopicId, agentDocumentId, agentId, documentId, isEmbedded],
    );

    const chatKey = useMemo(() => messageMapKey(context), [context]);

    const operationState = useOperationState(context);
    const defaultActionsBar = useActionsBarConfig();
    const resolvedActionsBar = actionsBar ?? defaultActionsBar;
    const [isCollapsed, setIsCollapsed] = useState(!defaultOpen);
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
            onTopicCreated: (createdTopicId) => {
              if (isEmbedded) setEmbeddedTopicId(createdTopicId);
            },
          },
          chatFollowUpHooks,
        ),
      [chatFollowUpHooks, expand, hooks, isEmbedded],
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
      className: stylex.props(styles.sheetSeamless).className,
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
      title: title ?? <span {...stylex.props(styles.titleSpacer)} />,
      variant: 'elevated',
      width,
    };

    return (
      <ConversationProvider
        actionsBar={resolvedActionsBar}
        context={context}
        hooks={mergedHooks}
        operationState={operationState}
      >
        <div
          {...stylex.props(styles.panel, isEmbedded && styles.panelEmbedded)}
          data-collapsed={isEmbedded ? false : isCollapsed}
          data-mode={mode}
          data-testid="floating-chat-panel"
        >
          {isEmbedded ? (
            <>
              <PageAgentPanelOverrideProvider defaultExpand>
                <CopilotToolbar
                  topicId={activeTopicId}
                  onCollapse={onCollapse}
                  onTopicChange={setEmbeddedTopicId}
                />
              </PageAgentPanelOverrideProvider>
              <ChatBody />
              <InputRow isCollapsed={false} showExpandBar={false} onExpand={expand} />
            </>
          ) : (
            <>
              <FloatingSheet {...sheetProps}>
                <ChatBody />
              </FloatingSheet>
              <InputRow isCollapsed={isCollapsed} onExpand={expand} />
            </>
          )}
        </div>
      </ConversationProvider>
    );
  },
);

FloatingChatPanel.displayName = 'FloatingChatPanel';

export default FloatingChatPanel;
