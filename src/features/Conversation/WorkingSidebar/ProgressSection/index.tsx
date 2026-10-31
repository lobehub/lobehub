import { Checkbox, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronUp, CircleArrowRight } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { selectCurrentTurnTodosFromMessages } from '@/store/chat/slices/message/selectors/dbMessage';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useAgentContext } from '../../useAgentContext';
import { normalizeTaskProgress } from './taskProgressAdapter';

const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

const styles = stylex.create({
  collapsed: {
    gridTemplateRows: '0fr',
    marginBlockStart: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: 0,
    opacity: 0,
  },
  count: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  expanded: { gridTemplateRows: '1fr', opacity: 1 },
  header: { fontSize: '10.5px', fontWeight: 600, color: cssVar.colorTextSecondary },
  headerRow: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingBlockStart: '4px',
    paddingBlockEnd: '6px',
    paddingInline: '10px',
    borderRadius: '6px',
    transition: 'background-color 0.12s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  itemRow: {
    paddingBlock: '6px',
    paddingInline: '4px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '13px',
  },
  listContainer: {
    display: 'grid',
    paddingBlock: '4px',
    paddingInline: '10px',
    transition: `grid-template-rows 0.25s ${cssVar.motionEaseInOut}, opacity 0.2s ${cssVar.motionEaseInOut}, padding 0.2s ${cssVar.motionEaseInOut}`,
  },
  listInner: {
    // Blockify the inline-flex Base UI Checkbox labels — without this the todo
    // rows flow inline and wrap several per line.
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  processingRow: { display: 'flex', gap: '6px', alignItems: 'center' },
  ring: { transform: 'rotate(-90deg)', flexShrink: 0 },
  ringProgress: { transition: 'stroke-dashoffset 240ms ease, stroke 240ms ease' },
  ringTrack: { stroke: cssVar.colorFillSecondary },
  textCompleted: { color: cssVar.colorTextQuaternary, textDecoration: 'line-through' },
  textProcessing: { color: cssVar.colorText },
  textTodo: { color: cssVar.colorTextSecondary },
});

const ProgressSection = memo<{ className?: string }>(({ className }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(true);
  const context = useAgentContext();
  const chatKey = messageMapKey(context);
  const dbMessages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const listId = useId();

  const progress = useMemo(
    () => normalizeTaskProgress(selectCurrentTurnTodosFromMessages(dbMessages || [])),
    [dbMessages],
  );

  const items = progress.items;
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);
  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleExpanded();
      }
    },
    [toggleExpanded],
  );

  if (total === 0) return null;

  const allDone = completed === total;
  const ringColor = allDone ? cssVar.colorSuccess : cssVar.colorInfo;
  const ringOffset = RING_CIRCUM * (1 - progress.completionPercent / 100);

  return (
    <div className={className} data-testid="workspace-progress">
      <Flexbox
        horizontal
        align="center"
        aria-controls={listId}
        aria-expanded={expanded}
        {...stylex.props(styles.headerRow)}
        gap={8}
        justify="space-between"
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={handleHeaderKeyDown}
      >
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
          <span {...stylex.props(styles.header)}>{t('workingPanel.progress')}</span>
          <span {...stylex.props(styles.count)}>
            {completed}/{total}
          </span>
        </Flexbox>
        <Icon
          icon={expanded ? ChevronUp : ChevronDown}
          size={14}
          style={{ color: cssVar.colorTextTertiary, flexShrink: 0 }}
        />
      </Flexbox>

      <div
        {...stylex.props(styles.listContainer, expanded ? styles.expanded : styles.collapsed)}
        id={listId}
      >
        <div {...stylex.props(styles.listInner)}>
          {items.map((item, index) => {
            const isCompleted = item.status === 'completed';
            const isProcessing = item.status === 'processing';

            if (isProcessing) {
              return (
                <div {...stylex.props(styles.itemRow, styles.processingRow)} key={item.id ?? index}>
                  <Icon
                    icon={CircleArrowRight}
                    size={17}
                    style={{ color: cssVar.colorTextSecondary }}
                  />
                  <span {...stylex.props(styles.textProcessing)}>{item.text}</span>
                </div>
              );
            }

            return (
              <Checkbox
                backgroundColor={cssVar.colorSuccess}
                checked={isCompleted}
                key={item.id ?? index}
                shape="circle"
                style={{ borderWidth: 1.5, cursor: 'default', pointerEvents: 'none' }}
                classNames={{
                  text: stylex.props(styles.textTodo, isCompleted && styles.textCompleted)
                    .className,
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
    </div>
  );
});

ProgressSection.displayName = 'ProgressSection';

export default ProgressSection;
