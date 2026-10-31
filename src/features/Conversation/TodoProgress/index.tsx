'use client';

import { type StepContextTodos } from '@lobechat/types';
import { Checkbox, Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronUp, CircleArrowRight } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { selectCurrentTurnTodosFromMessages } from '@/store/chat/slices/message/selectors/dbMessage';
import { shinyTextStyles } from '@/styles';
import { sx } from '@/styles/sx';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../store';

const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

const styles = stylex.create({
  collapsed: {
    maxHeight: 0,
    marginBlockStart: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: 0,
    borderBlockStartWidth: 0,
    opacity: 0,
  },
  container: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingBlockStart: '8px',
    paddingBlockEnd: '10px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderBlockEndWidth: 0,
    borderStartStartRadius: '12px',
    borderStartEndRadius: '12px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    transition: `all 0.2s ${cssVar.motionEaseInOut}`,
  },
  containerTopAttached: { borderStartStartRadius: 0, borderStartEndRadius: 0 },
  count: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  expanded: { maxHeight: '300px', opacity: 1 },
  header: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Left off while the shiny text effect runs: it paints the text through a
  // clipped gradient and owns `color`.
  headerColor: { color: cssVar.colorText },
  itemRow: {
    paddingBlock: '6px',
    paddingInline: '4px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '13px',
  },
  listContainer: {
    overflowX: 'hidden',
    overflowY: 'auto',
    overscrollBehaviorY: 'contain',
    // The rows are Base UI Checkbox labels, which are inline-flex. In a plain
    // block container they lay out as INLINE boxes — two or three short todos
    // share a line and the list wraps like prose. A column flex container
    // blockifies them, so one todo is one row again.
    display: 'flex',
    flexDirection: 'column',
    marginBlockStart: '8px',
    paddingBlock: '4px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    transition: `max-height 0.25s ${cssVar.motionEaseInOut}, opacity 0.2s ${cssVar.motionEaseInOut}, padding 0.2s ${cssVar.motionEaseInOut}`,
  },
  processingRow: { display: 'flex', gap: '6px', alignItems: 'center' },
  ring: { transform: 'rotate(-90deg)', flexShrink: 0 },
  ringProgress: { transition: 'stroke-dashoffset 240ms ease, stroke 240ms ease' },
  ringTrack: { stroke: cssVar.colorFillSecondary },
  textCompleted: { color: cssVar.colorTextQuaternary, textDecoration: 'line-through' },
  textProcessing: { color: cssVar.colorText },
  textTodo: { color: cssVar.colorTextSecondary },
});

interface TodoProgressProps {
  className?: string;
  /**
   * When true, square the top corners — used when another panel (e.g.
   * QueueTray) sits flush above this one in the stack so the seams align.
   */
  topAttached?: boolean;
}

const TodoProgress = memo<TodoProgressProps>(({ className, topAttached }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  // Get messages and AI generating state from conversation store
  const dbMessages = useConversationStore(dataSelectors.dbMessages);
  const isAIGenerating = useConversationStore(messageStateSelectors.isAIGenerating);

  // Extract todos produced within the current agent turn (after the last user
  // message). Older turns' todos intentionally drop out so a new operation
  // doesn't keep a stale completed progress bar on screen.
  const todos: StepContextTodos | undefined = useMemo(
    () => selectCurrentTurnTodosFromMessages(dbMessages),
    [dbMessages],
  );

  // Calculate progress
  const items = todos?.items || [];
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;
  const progressPercent = total > 0 ? (completed / total) * 100 : 0;

  // Find current pending task (first non-completed item, prioritize processing)
  const currentPendingTask =
    items.find((item) => item.status === 'processing') ||
    items.find((item) => item.status === 'todo');

  // Don't render if no todos
  if (total === 0) return null;

  const allDone = completed === total;
  const ringColor = allDone ? cssVar.colorSuccess : cssVar.colorInfo;
  const ringOffset = RING_CIRCUM * (1 - progressPercent / 100);

  const toggleExpanded = () => setExpanded(!expanded);

  return (
    <div
      {...sx([styles.container, topAttached && styles.containerTopAttached], className)}
      onClick={toggleExpanded}
    >
      {/* Header */}
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Flexbox horizontal align="center" gap={8} style={{ flex: 1, minWidth: 0 }}>
          <svg {...stylex.props(styles.ring)} height={RING_SIZE} width={RING_SIZE}>
            <circle
              {...stylex.props(styles.ringTrack)}
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              fill="none"
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
            />
            <circle
              {...stylex.props(styles.ringProgress)}
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              fill="none"
              r={RING_RADIUS}
              stroke={ringColor}
              strokeDasharray={RING_CIRCUM}
              strokeDashoffset={ringOffset}
              strokeLinecap="round"
              strokeWidth={RING_STROKE}
            />
          </svg>
          <span
            {...sx(
              [styles.header, !isAIGenerating && styles.headerColor],
              isAIGenerating ? shinyTextStyles.shinyText : undefined,
            )}
          >
            {currentPendingTask?.text ||
              t('todoProgress.allCompleted', { defaultValue: 'All tasks completed' })}
          </span>
          <Tag size="small" style={{ flexShrink: 0 }}>
            <span {...stylex.props(styles.count)}>
              {completed}/{total}
            </span>
          </Tag>
        </Flexbox>
        <Icon
          icon={expanded ? ChevronUp : ChevronDown}
          size={16}
          style={{ color: cssVar.colorTextTertiary, flexShrink: 0 }}
        />
      </Flexbox>

      {/* Expandable Todo List */}
      <div {...stylex.props(styles.listContainer, expanded ? styles.expanded : styles.collapsed)}>
        {items.map((item, index) => {
          const isCompleted = item.status === 'completed';
          const isProcessing = item.status === 'processing';

          // Processing state uses CircleArrowRight icon
          if (isProcessing) {
            return (
              <div {...stylex.props(styles.itemRow, styles.processingRow)} key={index}>
                <Icon
                  icon={CircleArrowRight}
                  size={17}
                  style={{ color: cssVar.colorTextSecondary }}
                />
                <span {...stylex.props(styles.textProcessing)}>{item.text}</span>
              </div>
            );
          }

          // Todo and completed states use Checkbox
          return (
            <Checkbox
              backgroundColor={cssVar.colorSuccess}
              checked={isCompleted}
              key={index}
              shape="circle"
              style={{ borderWidth: 1.5, cursor: 'default', pointerEvents: 'none' }}
              classNames={{
                text: stylex.props(styles.textTodo, isCompleted && styles.textCompleted).className,
                wrapper: stylex.props(styles.itemRow).className,
              }}
              textProps={{
                type: isCompleted ? 'secondary' : undefined,
              }}
            >
              {item.text}
            </Checkbox>
          );
        })}
      </div>
    </div>
  );
});

TodoProgress.displayName = 'TodoProgress';

export default TodoProgress;
