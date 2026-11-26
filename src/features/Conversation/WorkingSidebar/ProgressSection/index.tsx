import { Checkbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleArrowRight } from 'lucide-react';
import { memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { selectCurrentTurnTodosFromMessages } from '@/store/chat/slices/message/selectors/dbMessage';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import { useAgentContext } from '../../useAgentContext';
import { SectionHeader } from '../Overview/SectionHeader';
import { normalizeTaskProgress } from './taskProgressAdapter';

const RING_SIZE = 12;
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
  expanded: { gridTemplateRows: '1fr', opacity: 1 },
  itemRow: {
    gap: sidebarRow.gap,
    alignItems: 'center',
    minHeight: sidebarRow.height,
    paddingInline: '8px',
    fontSize: sidebarRow.textFontSize,
    lineHeight: sidebarRow.textLineHeight,
  },
  listContainer: {
    display: 'grid',
    paddingBlock: 0,
    paddingInline: 0,
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
  processingRow: { display: 'flex' },
  ring: { flexShrink: 0, transform: 'rotate(-90deg)' },
  ringProgress: { transition: 'stroke-dashoffset 240ms ease, stroke 240ms ease' },
  ringTrack: { stroke: cssVar.colorFillSecondary },
  textCompleted: { color: cssVar.colorTextQuaternary, textDecoration: 'line-through' },
  textProcessing: { color: cssVar.colorText },
  textTodo: { color: cssVar.colorTextSecondary },
});

const ProgressSection = memo<{ className?: string }>(({ className }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(true);
  const { iconSize } = useDensityTokens();
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

  if (total === 0) return null;

  const allDone = completed === total;
  const ringColor = allDone ? cssVar.colorSuccess : cssVar.colorInfo;
  const ringOffset = RING_CIRCUM * (1 - progress.completionPercent / 100);

  return (
    <div className={className} data-testid="workspace-progress">
      <SectionHeader
        collapsed={!expanded}
        controls={listId}
        count={`${completed}/${total}`}
        title={t('workingPanel.progress')}
        meta={
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
        }
        onToggle={toggleExpanded}
      />

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
                    size={iconSize}
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
