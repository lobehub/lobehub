'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type MouseEvent, type ReactNode } from 'react';
import { memo, Suspense, useCallback } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import SafeBoundary from '@/components/ErrorBoundary';

import History from '../components/History';
import { useChatItemContextMenu } from '../hooks/useChatItemContextMenu';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../store';
import AgentCouncilMessage from './AgentCouncil';
import AssistantMessage from './Assistant';
import AssistantGroupMessage from './AssistantGroup';
import type { WorkflowExpandLevel } from './AssistantGroup/components/WorkflowCollapse';
import CompressedGroupMessage from './CompressedGroup';
import GroupTasksMessage from './GroupTasks';
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
  defaultWorkflowExpandLevel?: WorkflowExpandLevel;
  disableEditing?: boolean;
  enableHistoryDivider?: boolean;
  endRender?: ReactNode;
  id: string;
  index: number;
  inPortalThread?: boolean;
  isLatestItem?: boolean;
}

const MessageItem = memo<MessageItemProps>(
  ({
    className,
    defaultWorkflowExpandLevel,
    enableHistoryDivider,
    id,
    endRender,
    disableEditing,
    inPortalThread = false,
    index,
    isLatestItem,
  }) => {
    const topic = useConversationStore((s) => s.context.topicId);

    // Get message from ConversationStore
    const message = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
    const role = message?.role;

    const [editing, isMessageCreating] = useConversationStore((s) => [
      messageStateSelectors.isMessageEditing(id)(s),
      messageStateSelectors.isMessageCreating(id)(s),
    ]);

    const { handleContextMenu } = useChatItemContextMenu({
      editing,
      id,
      inPortalThread,
      topic,
    });

    const onContextMenu = useCallback(
      async (event: MouseEvent<HTMLDivElement>) => {
        if (!role || (role !== 'user' && role !== 'assistant' && role !== 'assistantGroup')) return;

        if (!message) return;

        if (isDesktop) {
          const { electronSystemService } = await import('@/services/electron/system');

          // Get selected text for context menu features like Look Up and Search
          const selection = window.getSelection();
          const selectionText = selection?.toString() || '';

          electronSystemService.showContextMenu('chat', {
            content: message.content,
            hasError: !!message.error,
            messageId: id,
            // For assistantGroup, we treat it as assistant for context menu purposes
            role: message.role === 'assistantGroup' ? 'assistant' : message.role,
            selectionText,
          });

          return;
        }

        handleContextMenu(event);
      },
      [handleContextMenu, id, role, message],
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
              defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
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
          return <TasksMessage id={id} />;
        }

        case 'groupTasks': {
          return <GroupTasksMessage id={id} />;
        }

        case 'agentCouncil': {
          return <AgentCouncilMessage id={id} index={index} />;
        }

        case 'compressedGroup': {
          return <CompressedGroupMessage id={id} index={index} />;
        }

        case 'tool': {
          return <ToolMessage disableEditing={disableEditing} id={id} index={index} />;
        }
      }

      return null;
    }, [role, defaultWorkflowExpandLevel, disableEditing, id, index, isLatestItem]);

    if (!role) return;

    return (
      <>
        {enableHistoryDivider && <History />}
        <Flexbox
          className={cx(styles.message, className, isMessageCreating && styles.loading)}
          data-index={index}
          onContextMenu={onContextMenu}
        >
          <SafeBoundary variant="alert">
            <Suspense fallback={<BubblesLoading />}>{renderContent()}</Suspense>
          </SafeBoundary>
          {endRender}
        </Flexbox>
      </>
    );
  },
  isEqual,
);

MessageItem.displayName = 'MessageItem';

export default MessageItem;
