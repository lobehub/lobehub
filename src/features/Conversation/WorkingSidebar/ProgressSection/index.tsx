import { Checkbox, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
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

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapsed: css`
    grid-template-rows: 0fr;
    margin-block-start: 0 !important;
    padding-block: 0 !important;
    opacity: 0;
  `,
  count: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  expanded: css`
    grid-template-rows: 1fr;
    opacity: 1;
  `,
  header: css`
    font-size: 10.5px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.08em;
  `,
  headerRow: css`
    cursor: pointer;
    user-select: none;

    padding-block: 4px 6px;
    padding-inline: 10px;
    border-radius: 6px;

    transition: background-color 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
  itemRow: css`
    padding-block: 6px;
    padding-inline: 4px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};
    font-size: 13px;

    &:last-child {
      border-block-end: none;
    }
  `,
  listContainer: css`
    display: grid;
    padding-block: 4px;
    padding-inline: 10px;
    transition:
      grid-template-rows 0.25s ${cssVar.motionEaseInOut},
      opacity 0.2s ${cssVar.motionEaseInOut},
      padding 0.2s ${cssVar.motionEaseInOut};
  `,
  listInner: css`
    overflow: hidden;
    min-height: 0;
  `,
  processingRow: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
  ring: css`
    transform: rotate(-90deg);
    flex-shrink: 0;
  `,
  ringProgress: css`
    transition:
      stroke-dashoffset 240ms ease,
      stroke 240ms ease;
  `,
  ringTrack: css`
    stroke: ${cssVar.colorFillSecondary};
  `,
  textCompleted: css`
    color: ${cssVar.colorTextQuaternary};
    text-decoration: line-through;
  `,
  textProcessing: css`
    color: ${cssVar.colorText};
  `,
  textTodo: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const ProgressSection = memo(() => {
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
    <div data-testid="workspace-progress">
      <Flexbox
        horizontal
        align="center"
        aria-controls={listId}
        aria-expanded={expanded}
        className={styles.headerRow}
        gap={8}
        justify="space-between"
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={handleHeaderKeyDown}
      >
        <Flexbox horizontal align="center" gap={8} style={{ flex: 1, minWidth: 0 }}>
          <svg className={styles.ring} height={RING_SIZE} width={RING_SIZE}>
            <circle
              className={styles.ringTrack}
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              fill="none"
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
            />
            <circle
              className={styles.ringProgress}
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
          <span className={styles.header}>{t('workingPanel.progress')}</span>
          <span className={styles.count}>
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
        className={cx(styles.listContainer, expanded ? styles.expanded : styles.collapsed)}
        id={listId}
      >
        <div className={styles.listInner}>
          {items.map((item, index) => {
            const isCompleted = item.status === 'completed';
            const isProcessing = item.status === 'processing';

            if (isProcessing) {
              return (
                <div className={cx(styles.itemRow, styles.processingRow)} key={item.id ?? index}>
                  <Icon
                    icon={CircleArrowRight}
                    size={17}
                    style={{ color: cssVar.colorTextSecondary }}
                  />
                  <span className={styles.textProcessing}>{item.text}</span>
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
                  text: cx(styles.textTodo, isCompleted && styles.textCompleted),
                  wrapper: styles.itemRow,
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
