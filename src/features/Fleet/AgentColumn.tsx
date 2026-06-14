'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Avatar, Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  FolderIcon,
  GitBranchIcon,
  GripVertical,
  MessageCirclePlus,
  MessageSquareIcon,
  MoreHorizontalIcon,
  XIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import StatusDot from '@/features/AgentTopicManager/StatusDot';
import { ChatInput, ChatList, ConversationProvider } from '@/features/Conversation';
import OpStatusTray from '@/features/Conversation/ChatInput/OpStatusTray';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFetchGitInfo } from '@/store/device/gitHooks';
import { useElectronStore } from '@/store/electron';
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

    /* opaque while dragging so it doesn't show columns underneath */
    background: ${cssVar.colorBgContainer};
    box-shadow:
      inset 0 0 0 1px ${cssVar.colorBorder},
      ${cssVar.boxShadowSecondary};
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

/** Working directory + git branch subtitle (branch resolved live for local cwd). */
const WorkingDirRow = memo<{ workingDirectory: string }>(({ workingDirectory }) => {
  const { data } = useFetchGitInfo(undefined, workingDirectory);
  const dirName = workingDirectory.split('/').findLast(Boolean) ?? workingDirectory;

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      paddingInline={'22px 0'}
      style={{ color: cssVar.colorTextTertiary, overflow: 'hidden' }}
    >
      <Icon icon={FolderIcon} size={12} style={{ flex: 'none' }} />
      <Text ellipsis fontSize={11} style={{ color: 'inherit', flex: 'none', maxWidth: '55%' }}>
        {dirName}
      </Text>
      {data?.branch ? (
        <>
          <Icon icon={GitBranchIcon} size={12} style={{ flex: 'none' }} />
          <Text ellipsis fontSize={11} style={{ color: 'inherit', flex: 1 }}>
            {data.branch}
          </Text>
        </>
      ) : null}
    </Flexbox>
  );
});

WorkingDirRow.displayName = 'FleetWorkingDirRow';

interface AgentColumnProps {
  column: FleetColumn;
  status: ChatTopicStatus | undefined;
}

const AgentColumn = memo<AgentColumnProps>(({ column, status }) => {
  const { t } = useTranslation('electron');
  const meta = useAgentDisplayMeta(column.agentId);
  const addTab = useElectronStore((s) => s.addTab);
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
      {/* Column header — topic title (primary), agent name + status, dir + branch */}
      <Flexbox className={styles.header} gap={4}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={cx(styles.grip)} {...attributes} {...listeners}>
            <GripVertical size={16} />
          </span>
          <Text ellipsis style={{ flex: 1, fontWeight: 600 }} title={column.fallbackTitle}>
            {column.fallbackTitle}
          </Text>
          <Flexbox horizontal align={'center'} gap={2} style={{ flex: 'none' }}>
            <DropdownMenu
              placement={'bottomRight'}
              items={[
                {
                  icon: <Icon icon={MessageSquareIcon} />,
                  key: 'open-in-chat',
                  label: t('fleet.openInChat'),
                  onClick: () => addTab(buildChatPath(column)),
                },
              ]}
            >
              <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
            </DropdownMenu>
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
        {column.workingDirectory ? (
          <WorkingDirRow workingDirectory={column.workingDirectory} />
        ) : null}
      </Flexbox>

      {/* Conversation body — ChatList, running-op tray, on-demand reply input */}
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
          <OpStatusTray />
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
