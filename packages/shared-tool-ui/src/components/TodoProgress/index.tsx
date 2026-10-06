'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleArrowRight, CircleCheckBig, ListTodo } from 'lucide-react';
import { memo } from 'react';

import { shinyTextStyles } from '../../styles';

/**
 * Visual state of a todo summary:
 * - inProgress: a step is currently running
 * - completedStep: no running step, show the most recently completed one
 * - allDone: every step is completed
 * - idle: nothing completed or running yet
 */
export type TodoSummaryState = 'allDone' | 'completedStep' | 'idle' | 'inProgress';

export interface TodoSummary {
  completed: number;
  /** Step text shown after the label (current step or last completed step) */
  detail?: string;
  state: TodoSummaryState;
  total: number;
}

const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

const styles = createStaticStyles(({ css, cssVar }) => ({
  countChip: css`
    flex-shrink: 0;

    margin-inline-end: 8px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  headerCount: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  headerDetail: css`
    overflow: hidden;
    min-width: 0;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
  `,
  headerLabel: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    gap: 0;
    align-items: center;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  ring: css`
    transform: rotate(-90deg);
    flex-shrink: 0;
    margin-inline-end: 6px;
  `,
  ringProgress: css`
    transition:
      stroke-dashoffset 240ms ease,
      stroke 240ms ease;
  `,
  ringTrack: css`
    stroke: ${cssVar.colorFillSecondary};
  `,
  summaryDetail: css`
    color: ${cssVar.colorText};
  `,
  summaryText: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const STATE_ICONS = {
  allDone: CircleCheckBig,
  completedStep: CircleCheckBig,
  idle: ListTodo,
  inProgress: CircleArrowRight,
} as const;

const stateColor = (state: TodoSummaryState) => {
  switch (state) {
    case 'inProgress': {
      return cssVar.colorInfo;
    }
    case 'idle': {
      return cssVar.colorTextSecondary;
    }
    default: {
      return cssVar.colorSuccess;
    }
  }
};

interface TodoProgressRingProps {
  completed: number;
  total: number;
}

export const TodoProgressRing = memo<TodoProgressRingProps>(({ completed, total }) => {
  const ratio = total > 0 ? completed / total : 0;
  const allDone = total > 0 && completed === total;
  const color = allDone ? cssVar.colorSuccess : cssVar.colorInfo;

  return (
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
        stroke={color}
        strokeDasharray={RING_CIRCUM}
        strokeDashoffset={RING_CIRCUM * (1 - ratio)}
        strokeLinecap="round"
        strokeWidth={RING_STROKE}
      />
    </svg>
  );
});

TodoProgressRing.displayName = 'TodoProgressRing';

interface TodoSummaryContentProps {
  label: string;
  shiny?: boolean;
  summary: TodoSummary;
}

/**
 * Inline inspector summary: progress ring + count chip + "label: detail".
 * Render it inside an `inspectorTextStyles.root` flex container.
 */
export const TodoInspectorSummary = memo<TodoSummaryContentProps>(({ label, shiny, summary }) => {
  const { completed, detail, state, total } = summary;

  return (
    <>
      {total > 0 && <TodoProgressRing completed={completed} total={total} />}
      {total > 0 && state !== 'allDone' && (
        <span className={styles.countChip}>
          {completed}/{total}
        </span>
      )}
      <span className={styles.summaryText}>
        <span className={cx(shiny && shinyTextStyles.shinyText)}>{label}</span>
        {detail && (
          <>
            {': '}
            <span className={styles.summaryDetail}>{detail}</span>
          </>
        )}
      </span>
    </>
  );
});

TodoInspectorSummary.displayName = 'TodoInspectorSummary';

/**
 * Header row for the expanded todo list panel:
 * state icon + "label: detail" + count badge on the right.
 */
export const TodoPanelHeader = memo<TodoSummaryContentProps>(({ label, summary }) => {
  const { completed, detail, state, total } = summary;

  return (
    <div className={styles.header}>
      <Icon
        icon={STATE_ICONS[state]}
        size={16}
        style={{ color: stateColor(state), flexShrink: 0 }}
      />
      <div className={styles.headerLabel}>
        <span>{label}</span>
        {detail && (
          <>
            <span>{': '}</span>
            <span className={styles.headerDetail}>{detail}</span>
          </>
        )}
      </div>
      <span className={styles.headerCount}>
        {completed}/{total}
      </span>
    </div>
  );
});

TodoPanelHeader.displayName = 'TodoPanelHeader';
