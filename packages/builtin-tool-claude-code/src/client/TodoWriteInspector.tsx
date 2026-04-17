'use client';

import {
  highlightTextStyles,
  inspectorTextStyles,
  shinyTextStyles,
} from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type ClaudeCodeTodoItem, type TodoWriteArgs } from '../types';

const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

const styles = createStaticStyles(({ css, cssVar }) => ({
  ring: css`
    transform: rotate(-90deg);
    flex-shrink: 0;
    margin-inline-end: 6px;
  `,
  ringTrack: css`
    stroke: ${cssVar.colorFillSecondary};
  `,
  ringProgress: css`
    transition:
      stroke-dashoffset 240ms ease,
      stroke 240ms ease;
  `,
}));

interface TodoStats {
  completed: number;
  inProgress?: ClaudeCodeTodoItem;
  total: number;
}

interface ProgressRingProps {
  stats: TodoStats;
}

const ProgressRing = memo<ProgressRingProps>(({ stats }) => {
  const { completed, total } = stats;
  const ratio = total > 0 ? completed / total : 0;
  const allDone = total > 0 && completed === total;
  const color = allDone ? cssVar.colorSuccess : cssVar.colorPrimary;

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

ProgressRing.displayName = 'ClaudeCodeTodoProgressRing';

const computeStats = (args?: TodoWriteArgs): TodoStats => {
  const todos = args?.todos ?? [];
  return {
    completed: todos.filter((t) => t?.status === 'completed').length,
    inProgress: todos.find((t) => t?.status === 'in_progress'),
    total: todos.length,
  };
};

const getSummary = (stats: TodoStats): string | undefined => {
  if (stats.total === 0) return undefined;
  if (stats.inProgress) return stats.inProgress.activeForm || stats.inProgress.content;
  return `${stats.completed}/${stats.total}`;
};

export const TodoWriteInspector = memo<BuiltinInspectorProps<TodoWriteArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.TodoWrite as any);

    const stats = useMemo(() => computeStats(args || partialArgs), [args, partialArgs]);
    const summary = getSummary(stats);

    if (isArgumentsStreaming && stats.total === 0) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        {stats.total > 0 && <ProgressRing stats={stats} />}
        <span>{label}</span>
        {summary && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{summary}</span>
          </>
        )}
      </div>
    );
  },
);

TodoWriteInspector.displayName = 'ClaudeCodeTodoWriteInspector';
