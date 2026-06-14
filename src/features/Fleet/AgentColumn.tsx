'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { GripVertical, MessageSquareIcon, XIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { ChatInput, ChatList, ConversationProvider } from '@/features/Conversation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { type ChatTopicStatus } from '@/types/topic';

import { resolveStatusTone } from './status';
import StatusBadge from './StatusBadge';
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
    opacity: 0.5;
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
  resize: css`
    cursor: col-resize;

    position: absolute;
    z-index: 3;
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
  const width = dragWidth ?? storedWidth ?? DEFAULT_COLUMN_WIDTH;

  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const operationState = useOperationState(context);
  const liveRunning = useChatStore(operationSelectors.isAgentRuntimeRunningByContext(context));
  const tone = resolveStatusTone(status ?? undefined, liveRunning);

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
      {/* Column header — agent name + ops, then topic title + status */}
      <Flexbox className={styles.header} gap={6}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={cx(styles.grip)} {...attributes} {...listeners}>
            <GripVertical size={16} />
          </span>
          <Avatar
            emojiScaleWithBackground
            avatar={meta?.avatar}
            background={meta?.backgroundColor}
            shape={'square'}
            size={22}
          />
          <Text ellipsis style={{ flex: 1, fontWeight: 600 }}>
            {meta?.title}
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
        <Flexbox horizontal align={'center'} gap={8} paddingInline={'22px 0'}>
          <Text
            ellipsis
            style={{ color: cssVar.colorTextSecondary, flex: 1, fontSize: 13 }}
            title={column.fallbackTitle}
          >
            {column.fallbackTitle}
          </Text>
          <StatusBadge tone={tone} />
        </Flexbox>
      </Flexbox>

      {/* Conversation body — ChatList + scoped ChatInput */}
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
          <ChatInput skipScrollMarginWithList />
        </ConversationProvider>
      </Flexbox>

      {/* Resize handle on the inline-end edge */}
      <div className={cx(styles.resize, 'fleet-col-resize')} onPointerDown={handleResize} />
    </Flexbox>
  );
});

AgentColumn.displayName = 'FleetAgentColumn';

export default AgentColumn;
