'use client';

import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  countChip: {
    flexShrink: 0,
    marginInlineEnd: '8px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  header: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    background: cssVar.colorFillQuaternary,
  },
  headerCount: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  headerDetail: {
    overflow: 'hidden',
    minWidth: '0',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
  },
  headerLabel: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    gap: '0',
    alignItems: 'center',
    minWidth: '0',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ring: { transform: 'rotate(-90deg)', flexShrink: 0, marginInlineEnd: '6px' },
  ringProgress: { transition: 'stroke-dashoffset 240ms ease,\n      stroke 240ms ease' },
  ringTrack: { stroke: cssVar.colorFillSecondary },
  summaryDetail: { color: cssVar.colorText },
  summaryText: {
    overflow: 'hidden',
    minWidth: '0',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
        <span {...stylex.props(styles.countChip)}>
          {completed}/{total}
        </span>
      )}
      <span {...stylex.props(styles.summaryText)}>
        <span className={cx(shiny && shinyTextStyles.shinyText)}>{label}</span>
        {detail && (
          <>
            {': '}
            <span {...stylex.props(styles.summaryDetail)}>{detail}</span>
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
    <div {...stylex.props(styles.header)}>
      <Icon
        icon={STATE_ICONS[state]}
        size={16}
        style={{ color: stateColor(state), flexShrink: 0 }}
      />
      <div {...stylex.props(styles.headerLabel)}>
        <span>{label}</span>
        {detail && (
          <>
            <span>{': '}</span>
            <span {...stylex.props(styles.headerDetail)}>{detail}</span>
          </>
        )}
      </div>
      <span {...stylex.props(styles.headerCount)}>
        {completed}/{total}
      </span>
    </div>
  );
});

TodoPanelHeader.displayName = 'TodoPanelHeader';
