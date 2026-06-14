'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Avatar, Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { GripVertical, MessageCirclePlus, MessageSquareIcon, XIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import StatusDot from '@/features/AgentTopicManager/StatusDot';
import { ChatInput, ChatList, ConversationProvider } from '@/features/Conversation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { type ChatTopicStatus } from '@/types/topic';

import { useFleetStore } from './store';
import {
  DEFAULT_COLUMN_WIDTH,
  type FleetColumn,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  toConversationContext,
} from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    width: 100%;
  `,
  column: css`
    position: relative;
    flex: none;
    height: 100%;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  dragging: css`
    z-index: 2;
    box-shadow: inset 0 0 0 1px ${cssVar.colorBorder};

    /* tint overlay above the column content while dragging */
    &::before {
      pointer-events: none;
      content: '';

      position: absolute;
      z-index: 5;
      inset: 0;

      background: ${cssVar.colorFillTertiary};
    }
  `,
  grip: css`
    cursor: grab;
    flex: none;
    color: ${cssVar.colorTextQuaternary};
    transition: color 0.15s;

    &:hover {
      color: ${cssVar.colorTextTertiary};
    }

    &:active {
      cursor: grabbing;
    }
  `,
  header: css`
    flex: none;
    padding-block: 8px;
    padding-inline: 8px 6px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  replyBar: css`
    flex: none;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  resize: css`
    cursor: col-resize;

    position: absolute;
    z-index: 6;
    inset-block: 0;
    inset-inline-end: -3px;

    width: 6px;

    opacity: 0;

    transition: opacity 0.15s;

    &::after {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 2px;

      width: 2px;

      background: ${cssVar.colorPrimaryBorder};
    }

    &:hover {
      opacity: 1;
    }
  `,
}));

const buildChatPath = (column: FleetColumn) =>
  column.topicId ? `/agent/${column.agentId}/${column.topicId}` : `/agent/${column.agentId}`;

interface AgentColumnProps {
  column: FleetColumn;
  status: ChatTopicStatus | undefined;
}

const AgentColumn = memo<AgentColumnProps>(({ column, status }) => {
  const { t } = useTranslation('electron');
  const navigate = useWorkspaceAwareNavigate();
  const meta = useAgentDisplayMeta(column.agentId);
  const context = useMemo(() => toConversationContext(column), [column]);

  const storedWidth = useFleetStore((s) => s.widths[column.key]);
  const setWidth = useFleetStore((s) => s.setWidth);
  const removeColumn = useFleetStore((s) => s.removeColumn);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const width = dragWidth ?? storedWidth ?? DEFAULT_COLUMN_WIDTH;

  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const operationState = useOperationState(context);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
  });

  const handleResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = width;
      const clamp = (next: number) => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, next));
      const onMove = (ev: PointerEvent) => setDragWidth(clamp(startWidth + ev.clientX - startX));
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setWidth(column.key, clamp(startWidth + ev.clientX - startX));
        setDragWidth(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width, column.key, setWidth],
  );

  return (
    <Flexbox
      className={cx(styles.column, isDragging && styles.dragging)}
      data-fleet-col={column.key}
      ref={setNodeRef}
      style={{
        flex: `0 0 ${width}px`,
        transform: CSS.Translate.toString(transform),
        transition,
        width,
      }}
    >
      {/* Column header — topic title (primary), then agent name + status */}
      <Flexbox className={styles.header} gap={4}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={cx(styles.grip)} {...attributes} {...listeners}>
            <GripVertical size={16} />
          </span>
          <Text ellipsis style={{ flex: 1, fontWeight: 600 }} title={column.fallbackTitle}>
            {column.fallbackTitle}
          </Text>
          <Flexbox horizontal align={'center'} gap={2} style={{ flex: 'none' }}>
            <ActionIcon
              icon={MessageSquareIcon}
              size={'small'}
              title={t('fleet.openInChat')}
              onClick={() => navigate(buildChatPath(column))}
            />
            <ActionIcon
              icon={XIcon}
              size={'small'}
              title={t('fleet.closeColumn')}
              onClick={() => removeColumn(column.key)}
            />
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={6} paddingInline={'22px 0'}>
          <Avatar
            emojiScaleWithBackground
            avatar={meta?.avatar}
            background={meta?.backgroundColor}
            shape={'square'}
            size={16}
          />
          <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'}>
            {meta?.title}
          </Text>
          <StatusDot status={status ?? 'running'} />
        </Flexbox>
      </Flexbox>

      {/* Conversation body — ChatList, plus an on-demand reply input */}
      <Flexbox className={styles.body}>
        <ConversationProvider
          context={context}
          hasInitMessages={!!messages}
          messages={messages}
          operationState={operationState}
          onMessagesChange={(next, ctx) => {
            replaceMessages(next, { context: ctx });
          }}
        >
          <ChatList disableActionsBar />
          {replyOpen ? (
            <ChatInput skipScrollMarginWithList isConfigLoading={messages === undefined} />
          ) : (
            <Flexbox className={styles.replyBar}>
              <Button
                block
                icon={MessageCirclePlus}
                variant={'filled'}
                onClick={() => setReplyOpen(true)}
              >
                {t('fleet.reply')}
              </Button>
            </Flexbox>
          )}
        </ConversationProvider>
      </Flexbox>

      {/* Resize handle on the inline-end edge */}
      <div className={cx(styles.resize, 'fleet-col-resize')} onPointerDown={handleResize} />
    </Flexbox>
  );
});

AgentColumn.displayName = 'FleetAgentColumn';

export default AgentColumn;
