'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  Suspense,
  memo,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { VListHandle } from 'virtua';

import BubblesLoading from '@/components/BubblesLoading';

import ContextMenu from '../components/ContextMenu';
import History from '../components/History';
import { useChatItemContextMenu } from '../hooks/useChatItemContextMenu';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  virtuaListSelectors,
} from '../store';
import AgentCouncilMessage from './AgentCouncil';
import AssistantMessage from './Assistant';
import AssistantGroupMessage from './AssistantGroup';
import SupervisorMessage from './Supervisor';
import TaskMessage from './Task';
import TasksMessage from './Tasks';
import ToolMessage from './Tool';
import UserMessage from './User';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  loading: css`
    opacity: 0.6;
  `,
  message: css`
    position: relative;
    // prevent the textarea too long
    .${prefixCls}-input {
      max-height: 900px;
    }
  `,
}));

export interface MessageItemProps {
  className?: string;
  disableEditing?: boolean;
  enableHistoryDivider?: boolean;
  endRender?: ReactNode;
  id: string;
  inPortalThread?: boolean;
  index: number;
  isLatestItem?: boolean;
}

const MessageItem = memo<MessageItemProps>(
  ({
    className,
    enableHistoryDivider,
    id,
    endRender,
    disableEditing,
    inPortalThread = false,
    index,
    isLatestItem,
  }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const topic = useConversationStore((s) => s.context.topicId);

    // Get message and actionsBar from ConversationStore
    const message = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
    const actionsBar = useConversationStore((s) => s.actionsBar);
    const role = message?.role;

    const [editing, isMessageCreating] = useConversationStore((s) => [
      messageStateSelectors.isMessageEditing(id)(s),
      messageStateSelectors.isMessageCreating(id)(s),
    ]);

    const {
      containerRef: contextMenuContainerRef,
      contextMenuState,
      handleContextMenu,
      hideContextMenu,
    } = useChatItemContextMenu({
      editing,
      onActionClick: () => {},
    });

    const setContainerRef = useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node;
        contextMenuContainerRef.current = node;
      },
      [contextMenuContainerRef],
    );

    const onContextMenu = useCallback(
      async (event: MouseEvent<HTMLDivElement>) => {
        if (!role || (role !== 'user' && role !== 'assistant' && role !== 'assistantGroup')) return;

        if (!message) return;

        if (isDesktop) {
          const { electronSystemService } = await import('@/services/electron/system');

          electronSystemService.showContextMenu('chat', {
            content: message.content,
            hasError: !!message.error,
            messageId: id,
            // For assistantGroup, we treat it as assistant for context menu purposes
            role: message.role === 'assistantGroup' ? 'assistant' : message.role,
          });

          return;
        }

        handleContextMenu(event);
      },
      [handleContextMenu, id, role, message],
    );
    // Get virtuaScrollMethods from ConversationStore
    const virtuaScrollMethods = useConversationStore(virtuaListSelectors.virtuaScrollMethods);

    // Create a ref-like object for ContextMenu compatibility
    // VirtuaScrollMethods is a subset of VListHandle with the methods ContextMenu needs
    const virtuaRef = useMemo<RefObject<VListHandle | null>>(
      () => ({ current: virtuaScrollMethods as VListHandle | null }),
      [virtuaScrollMethods],
    );

    const renderContent = useCallback(() => {
      switch (role) {
        case 'user': {
          return <UserMessage disableEditing={disableEditing} id={id} index={index} />;
        }

        case 'assistant': {
          return (
            <AssistantMessage
              disableEditing={disableEditing}
              id={id}
              index={index}
              isLatestItem={isLatestItem}
            />
          );
        }

        case 'assistantGroup': {
          return (
            <AssistantGroupMessage
              disableEditing={disableEditing}
              id={id}
              index={index}
              isLatestItem={isLatestItem}
            />
          );
        }

        case 'supervisor': {
          return (
            <SupervisorMessage
              disableEditing={disableEditing}
              id={id}
              index={index}
              isLatestItem={isLatestItem}
            />
          );
        }

        case 'task': {
          return (
            <TaskMessage
              disableEditing={disableEditing}
              id={id}
              index={index}
              isLatestItem={isLatestItem}
            />
          );
        }
        case 'tasks': {
          return <TasksMessage id={id} index={index} />;
        }

        case 'agentCouncil': {
          return <AgentCouncilMessage id={id} index={index} />;
        }

        case 'tool': {
          return <ToolMessage id={id} index={index} />;
        }
      }

      return null;
    }, [role, disableEditing, id, index, isLatestItem, actionsBar]);

    if (!role) return;

    return (
      <>
        {enableHistoryDivider && <History />}
        <Flexbox
          className={cx(styles.message, className, isMessageCreating && styles.loading)}
          data-index={index}
          onContextMenu={onContextMenu}
          ref={setContainerRef}
        >
          <Suspense fallback={<BubblesLoading />}>{renderContent()}</Suspense>
          {endRender}
        </Flexbox>
        <ContextMenu
          id={id}
          inPortalThread={inPortalThread}
          index={index}
          onClose={hideContextMenu}
          position={contextMenuState.position}
          selectedText={contextMenuState.selectedText}
          topic={topic}
          virtuaRef={virtuaRef}
          visible={contextMenuState.visible}
        />
      </>
    );
  },
  isEqual,
);

MessageItem.displayName = 'MessageItem';

export default MessageItem;
