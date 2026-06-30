'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Avatar, Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  FolderIcon,
  GitBranchIcon,
  GripVertical,
  MessageCirclePlus,
  MessageSquareIcon,
  MoreHorizontalIcon,
  MoveIcon,
  PinIcon,
  XIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import StatusDot from '@/features/AgentTopicManager/StatusDot';
import {
  ChatInput,
  ChatList,
  ConversationProvider,
  conversationSelectors,
  useConversationStore,
} from '@/features/Conversation';
import OpStatusTray from '@/features/Conversation/ChatInput/OpStatusTray';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFetchGitBranch } from '@/store/device/gitHooks';
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
  dragPreview: css`
    cursor: grabbing;

    overflow: hidden;

    width: 100%;
    height: 100%;
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
    box-shadow:
      inset 0 0 0 1px ${cssVar.colorBorder},
      ${cssVar.boxShadowSecondary};
  `,
  dragPreviewBody: css`
    flex: 1;
    padding: 16px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
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
  list: css`
    /* Owns the flexible space so the seamless tray + reply bar below keep their
       natural height instead of being squeezed (and clipped) by the list. */
    position: relative;
    flex: 1;
    min-height: 0;
  `,
  replyBar: css`
    flex: none;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  replyClose: css`
    pointer-events: none;

    position: absolute;
    z-index: 11;
    inset-block-end: 100%;
    inset-inline-start: 12px;

    /* sit just above the input's top edge */
    overflow: hidden;

    margin-block-end: 4px;
    border-radius: ${cssVar.borderRadius};

    /* opaque chip so the conversation behind never bleeds through the button */
    background: ${cssVar.colorBgContainer};

    /* lifted above the floating status tray (translateY set inline) so it never
       overlaps and cuts into the tray's top border */
    transition: transform 0.2s ${cssVar.motionEaseInOut};

    button {
      pointer-events: auto;
    }
  `,
  replyOpen: css`
    position: relative;
    flex: none;
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
  const { data } = useFetchGitBranch(undefined, workingDirectory);
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

/**
 * Expanded reply input. The running-op status tray is owned by ChatInput's own
 * floating overlay (so it carries proper card chrome + top border), so we don't
 * render a second tray here. The collapse button is lifted above that overlay by
 * its measured height, keeping it clear of the tray's top edge.
 *
 * `onCollapse` is omitted for a brand-new (empty) conversation — there's nothing
 * to collapse back to yet, so the input just stays open until the first message.
 */
const ReplyPanel = memo<{ onCollapse?: () => void }>(({ onCollapse }) => {
  const { t } = useTranslation('electron');
  const overlayHeight = useConversationStore(conversationSelectors.chatInputOverlayHeight);

  return (
    <Flexbox className={styles.replyOpen}>
      {onCollapse && (
        <Flexbox
          horizontal
          className={styles.replyClose}
          style={{ transform: overlayHeight ? `translateY(-${overlayHeight}px)` : undefined }}
        >
          <Button icon={ChevronDownIcon} size={'small'} type={'text'} onClick={onCollapse}>
            {t('fleet.collapseReply')}
          </Button>
        </Flexbox>
      )}
      <ChatInput isConfigLoading={false} />
    </Flexbox>
  );
});

ReplyPanel.displayName = 'FleetReplyPanel';

/**
 * Bottom reply affordance for a column. Lives inside ConversationProvider so it
 * reads the conversation's *real* loaded state — never the raw dbMessagesMap
 * (where `undefined` means "still loading", not "empty"), which would blank the
 * area out during load.
 *
 * - Empty/new conversation → input shown directly (type immediately), no collapse.
 * - Has messages → "回复" button; expanding shows the input with a collapse button.
 * - Still loading an existing conversation → keep the "回复" button as a stable
 *   placeholder so the reply area never disappears.
 */
const ReplyArea = memo(() => {
  const { t } = useTranslation('electron');
  const [replyOpen, setReplyOpen] = useState(false);

  // `messagesInit` mirrors ChatList's own "loaded" gate; a topic-less column is
  // treated as ready-and-empty immediately (nothing to fetch).
  const isNewConversation = useConversationStore((s) => !s.context.topicId);
  const messagesInit = useConversationStore(conversationSelectors.messagesInit);
  const messageCount = useConversationStore(
    (s) => conversationSelectors.displayMessageIds(s).length,
  );

  const isReady = isNewConversation || messagesInit;
  const isEmptyConversation = isReady && messageCount === 0;
  const inputExpanded = replyOpen || isEmptyConversation;

  return (
    <>
      {/* Seamless inline tray only when collapsed — when expanded, ChatInput's
          own overlay hosts the tray, so a second one here would duplicate it. */}
      {!inputExpanded && <OpStatusTray seamless />}
      {inputExpanded ? (
        <ReplyPanel onCollapse={isEmptyConversation ? undefined : () => setReplyOpen(false)} />
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
    </>
  );
});

ReplyArea.displayName = 'FleetReplyArea';

/**
 * Lightweight drag visual rendered into the DragOverlay portal — the column
 * header on a lifted card with a centered "moving" hint instead of the live
 * conversation, so dragging stays cheap and isn't clipped by a band's overflow.
 */
export const ColumnDragPreview = memo<{
  column: FleetColumn;
  status: ChatTopicStatus | undefined;
}>(({ column, status }) => {
  const { t } = useTranslation('electron');
  const meta = useAgentDisplayMeta(column.agentId);

  return (
    <Flexbox className={styles.dragPreview}>
      <Flexbox className={styles.header} gap={4}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={styles.grip}>
            <GripVertical size={16} />
          </span>
          <Text ellipsis style={{ flex: 1, fontWeight: 600 }}>
            {column.fallbackTitle}
          </Text>
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
          <StatusDot status={status} />
        </Flexbox>
        {column.workingDirectory ? (
          <WorkingDirRow workingDirectory={column.workingDirectory} />
        ) : null}
      </Flexbox>
      {/* Centered hint so the lifted card reads as a column being moved, not loading */}
      <Flexbox align={'center'} className={styles.dragPreviewBody} gap={8} justify={'center'}>
        <Icon icon={MoveIcon} size={22} />
        <Text style={{ color: cssVar.colorTextTertiary, fontSize: 13 }}>{t('fleet.dragHint')}</Text>
      </Flexbox>
    </Flexbox>
  );
});

ColumnDragPreview.displayName = 'FleetColumnDragPreview';

interface AgentColumnProps {
  column: FleetColumn;
  status: ChatTopicStatus | undefined;
}

const AgentColumn = memo<AgentColumnProps>(({ column, status }) => {
  const { t } = useTranslation('electron');
  const meta = useAgentDisplayMeta(column.agentId);
  const addTab = useElectronStore((s) => s.addTab);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const context = useMemo(() => toConversationContext(column), [column]);

  const storedWidth = useFleetStore((s) => s.widths[column.key]);
  const setWidth = useFleetStore((s) => s.setWidth);
  const removeColumn = useFleetStore((s) => s.removeColumn);
  const togglePin = useFleetStore((s) => s.togglePin);
  const isPinned = useFleetStore((s) => s.pinnedKeys.includes(column.key));
  const [dragWidth, setDragWidth] = useState<number | null>(null);
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
      className={styles.column}
      data-fleet-col={column.key}
      ref={setNodeRef}
      style={{
        // While dragging, the source becomes an invisible gap slot — the moving
        // visual is the portaled DragOverlay (ColumnDragPreview), so it escapes
        // each band's overflow clipping and any z-index stacking.
        flex: `0 0 ${width}px`,
        opacity: isDragging ? 0 : undefined,
        transform: isDragging ? undefined : CSS.Translate.toString(transform),
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
            <ActionIcon
              active={isPinned}
              icon={PinIcon}
              size={'small'}
              title={isPinned ? t('fleet.unpin') : t('fleet.pin')}
              onClick={() => togglePin(column.key)}
            />
            <DropdownMenu
              placement={'bottomRight'}
              items={[
                {
                  icon: <Icon icon={MessageSquareIcon} />,
                  key: 'open-in-chat',
                  label: t('fleet.openInChat'),
                  onClick: () =>
                    addTab(buildWorkspaceAwarePath(buildChatPath(column), activeWorkspaceSlug)),
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
          <StatusDot status={status} />
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
          <Flexbox className={styles.list}>
            <ChatList disableActionsBar />
          </Flexbox>
          <ReplyArea />
        </ConversationProvider>
      </Flexbox>

      {/* Resize handle on the inline-end edge */}
      <div className={cx(styles.resize, 'fleet-col-resize')} onPointerDown={handleResize} />
    </Flexbox>
  );
});

AgentColumn.displayName = 'FleetAgentColumn';

export default AgentColumn;
