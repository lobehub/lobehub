'use client';

import { type UIChatMessage } from '@lobechat/types';
import { FloatingSheet, type FloatingSheetProps } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';

import {
  type ActionsBarConfig,
  type ConversationHooks,
  ConversationProvider,
} from '@/features/Conversation';
import { type ConversationContext } from '@/features/Conversation/types';
import { useOperationState } from '@/hooks/useOperationState';
import { useActionsBarConfig } from '@/routes/(main)/agent/features/Conversation/useActionsBarConfig';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ChatBody from './ChatBody';
import { useSingleInstanceGuard } from './guard';

const SNAP_POINTS = [180, 320, 520, 800] as const;
const MAX_SNAP_POINT = SNAP_POINTS.at(-1)!;
const REST_SNAP_POINT = SNAP_POINTS[0];

const styles = createStaticStyles(({ css }) => ({
  sheet: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  header: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  title: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  body: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100%;
    min-height: 0;
  `,
}));

export interface FloatingChatPanelProps {
  /**
   * Override the actions bar config. When omitted, defaults to the shared
   * `useActionsBarConfig()` hook for parity with the main agent page.
   */
  actionsBar?: ActionsBarConfig;
  activeSnapPoint?: number;
  /** Agent identifier. */
  agentId: string;
  className?: string;
  dismissible?: boolean;
  /** Current document identifier for page-scoped conversations. */
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
  /** Optional conversation scope override for non-thread contexts. */
  scope?: 'main' | 'page';
  snapPoints?: number[];
  /** Optional thread identifier. When provided, scope becomes `'thread'`. */
  threadId?: string | null;
  title?: ReactNode;
  /** Topic identifier. `null` means a new / unpersisted conversation. */
  topicId: string | null;
  variant?: 'elevated' | 'embedded';
  width?: number | string;
}

/**
 * FloatingChatPanel
 *
 * A reusable floating conversation panel. Composes ChatList + MainChatInput inside
 * a container shell. Consumers provide conversation coordinates via flat
 * `agentId`/`topicId` props; the component builds its own `ConversationContext`
 * internally.
 *
 * @FIXME ⚠️ Single instance per page. Mounting a second FloatingChatPanel while one is
 * already mounted will throw. See `./guard.ts` for the rationale.
 *
 * @FIXME ⚠️ Must not coexist with the main-page ConversationArea (both use MainChatInput,
 * which writes to the global `useChatStore.mainInputEditor` slot). This is NOT
 * enforced at runtime — consumer responsibility.
 */
const FloatingChatPanel = memo<FloatingChatPanelProps>(
  ({
    agentId,
    topicId,
    threadId = null,
    documentId,
    scope,
    actionsBar,
    hooks,

    minHeight: _minHeight = 240,
    maxHeight: _maxHeight = 0.9,

    width = '100%',

    title,
    headerActions,
  }) => {
    useSingleInstanceGuard();

    const context = useMemo<ConversationContext>(
      () => ({
        agentId,
        documentId,
        scope: threadId ? 'thread' : (scope ?? 'main'),
        threadId,
        topicId,
      }),
      [agentId, documentId, scope, topicId, threadId],
    );

    const chatKey = useMemo(() => messageMapKey(context), [context]);
    const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
    const replaceMessages = useChatStore((s) => s.replaceMessages);

    const operationState = useOperationState(context);
    const defaultActionsBar = useActionsBarConfig();
    const resolvedActionsBar = actionsBar ?? defaultActionsBar;

    const handleMessagesChange = useMemo(
      () => (next: UIChatMessage[], ctx: ConversationContext) => {
        replaceMessages(next, { context: ctx });
      },
      [replaceMessages],
    );

    const [open, setOpen] = useState(true);
    const [activeSnapPoint, setActiveSnapPoint] = useState<number>(REST_SNAP_POINT);

    const mergedHooks = useMemo<ConversationHooks>(
      () => ({
        ...hooks,
        // Expand the sheet the moment the user presses Send, so the chat grows
        // into view before the AI response streams in — not after it finishes.
        onBeforeSendMessage: async (params) => {
          setActiveSnapPoint(MAX_SNAP_POINT);
          return hooks?.onBeforeSendMessage?.(params);
        },
      }),
      [hooks],
    );

    const sheetProps: FloatingSheetProps = {
      activeSnapPoint,
      className: 'floating-sheet-demo-inline',
      closeThreshold: 0.3,
      defaultOpen: true,
      dismissible: false,
      headerActions,

      maxHeight: MAX_SNAP_POINT,
      minHeight: SNAP_POINTS[1],
      mode: 'inline',
      onOpenChange: setOpen,
      onSnapPointChange: setActiveSnapPoint,
      open,
      restingHeight: REST_SNAP_POINT,
      snapPoints: [...SNAP_POINTS],
      title,

      variant: 'embedded',
      width,
    };

    return (
      <FloatingSheet {...sheetProps}>
        <div className={styles.body}>
          <ConversationProvider
            actionsBar={resolvedActionsBar}
            context={context}
            hasInitMessages={!!messages}
            hooks={mergedHooks}
            messages={messages}
            operationState={operationState}
            onMessagesChange={handleMessagesChange}
          >
            <ChatBody />
          </ConversationProvider>
        </div>
      </FloatingSheet>
    );
  },
);

FloatingChatPanel.displayName = 'FloatingChatPanel';

export default FloatingChatPanel;
