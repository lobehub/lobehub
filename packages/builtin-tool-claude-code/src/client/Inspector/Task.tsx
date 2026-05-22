'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ClaudeCodeApiName,
  type TaskCreateArgs,
  type TaskListArgs,
  type TaskUpdateArgs,
} from '../../types';

const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    flex-shrink: 1;

    min-width: 0;
    margin-inline-start: 4px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillSecondary};
  `,
  countChip: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
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
}));

/**
 * Items shape the CC adapter emits on `pluginState.todos` — normalized
 * `todo|processing|completed` alphabet. Mirrors `StepContextTodos` from
 * `@lobechat/types` but inlined to keep this package light.
 *
 * `id` is optional: legacy TodoWrite-derived snapshots are positional and
 * have no stable id, while the Task* tools (CC 2.1.143+) populate it with
 * the CC-server-assigned numeric id so per-call inspectors can look up
 * subject text by `args.taskId`.
 */
interface TaskPluginStateItem {
  id?: string;
  status: 'todo' | 'processing' | 'completed';
  text: string;
}

interface TaskPluginState {
  todos?: {
    items?: TaskPluginStateItem[];
    updatedAt?: string;
  };
}

interface TaskStats {
  completed: number;
  inProgress?: TaskPluginStateItem;
  total: number;
}

const computeStats = (items: TaskPluginStateItem[]): TaskStats => ({
  completed: items.filter((item) => item.status === 'completed').length,
  inProgress: items.find((item) => item.status === 'processing'),
  total: items.length,
});

interface ProgressRingProps {
  stats: TaskStats;
}

const ProgressRing = memo<ProgressRingProps>(({ stats }) => {
  const { completed, total } = stats;
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

ProgressRing.displayName = 'ClaudeCodeTaskProgressRing';

type TaskInspectorArgs = TaskCreateArgs | TaskUpdateArgs | TaskListArgs;

/**
 * Unified inspector chip for CC 2.1.143+ task tools (TaskCreate / TaskUpdate /
 * TaskList). Reads the **adapter-synthesized** `pluginState.todos` snapshot —
 * not per-call args — because each individual TaskCreate / TaskUpdate carries
 * only a delta. The full list is only knowable after `applyTaskToolResult`
 * folds the delta into the running accumulator and emits a fresh snapshot
 * (see `claudeCode.ts:applyTaskToolResult`).
 *
 * Per-tool overrides for the inspector chip:
 *  - TaskCreate: the per-call action is "added one task" — the cumulative
 *    progress ring would read like `0/3` after three creates, which buries
 *    the actual new-task signal. Always show `Creating task: <subject>` from
 *    args, regardless of pluginState. Render-side, TaskCreate is also
 *    deliberately NOT registered in `ClaudeCodeRenders` — the chip carries
 *    the meaningful info; the default tool card handles args / result.
 *  - TaskUpdate / TaskList: the cumulative aggregate IS the meaningful
 *    signal (status flipped to completed = progress, list = snapshot), so
 *    keep the progress-ring + label + count chip that matches
 *    {@link TodoWriteInspector}.
 *
 * Streaming / loading fallbacks read args:
 *  - TaskUpdate → "Updating task #N"
 *  - TaskList   → "Listing tasks"
 */
export const TaskInspector = memo<BuiltinInspectorProps<TaskInspectorArgs, TaskPluginState>>(
  ({ apiName, args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const items = pluginState?.todos?.items ?? [];
    const stats = useMemo(() => computeStats(items), [items]);
    const allDone = stats.total > 0 && stats.completed === stats.total;

    // TaskCreate: chip identifies the task being added, not the accumulated
    // count — keep `Creating task: <subject>` as the label so per-row signal
    // stays sharp. The ProgressRing is rendered from the cumulative
    // pluginState snapshot; the trailing `completed/total` chip makes the
    // accumulation visible across rows (the ring alone stays empty while
    // every new task is still `todo`, so total wouldn't otherwise show).
    // Verb flips to past tense once the call finishes — the chip persists
    // in chat history and "Creating task" frozen on a settled row reads as
    // if it's still running (see ui.md principle 4).
    if (apiName === ClaudeCodeApiName.TaskCreate) {
      const subject = ((args || partialArgs) as TaskCreateArgs | undefined)?.subject;
      const inFlight = isArgumentsStreaming || isLoading;
      const label = t(
        inFlight
          ? 'builtins.lobe-claude-code.task.create.loading'
          : 'builtins.lobe-claude-code.task.create.completed',
      );
      const text = subject ? `${label}${subject}` : label;
      return (
        <div className={cx(inspectorTextStyles.root, inFlight && shinyTextStyles.shinyText)}>
          <ProgressRing stats={stats} />
          {stats.total > 0 && (
            <span className={styles.countChip}>
              {stats.completed}/{stats.total}
            </span>
          )}
          <span style={{ marginInlineStart: 6 }}>{text}</span>
        </div>
      );
    }

    // TaskUpdate with a `status` flip: the per-call signal IS that status
    // change ("Completed: Read hosts"), which the aggregate `Todos: x/y` chip
    // buries. Resolve subject from pluginState by id (CC adapter emits id on
    // every Task* synthesis, see `synthesizeTaskPluginState`); `args.subject`
    // is the resume-gap fallback when the snapshot hasn't been built yet.
    // Cryptic `#N` is intentionally NOT user-facing — fall back to the bare
    // verb if subject is missing (rare; happens before first pluginState).
    // Leading slot is the same ProgressRing as TaskCreate so the left edge
    // of a mixed create/update column reads as one continuous progress
    // gauge — the verb in the label carries the per-row status signal.
    // TaskUpdate without `status` (metadata-only edit) falls through to the
    // aggregate path — no single-word verb describes those.
    if (apiName === ClaudeCodeApiName.TaskUpdate) {
      const updateArgs = (args || partialArgs) as TaskUpdateArgs | undefined;
      const status = updateArgs?.status;
      if (status) {
        const taskId = updateArgs?.taskId;
        const subject =
          (taskId ? items.find((item) => item.id === taskId)?.text : undefined) ??
          updateArgs?.subject;
        const verb =
          status === 'deleted'
            ? t('builtins.lobe-claude-code.task.updateDeleted')
            : status === 'completed'
              ? t('builtins.lobe-claude-code.task.updateCompleted')
              : status === 'in_progress'
                ? t('builtins.lobe-claude-code.task.updateInProgress')
                : t('builtins.lobe-claude-code.task.updatePending');
        return (
          <div
            className={cx(
              inspectorTextStyles.root,
              (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
            )}
          >
            <ProgressRing stats={stats} />
            {stats.total > 0 && (
              <span className={styles.countChip}>
                {stats.completed}/{stats.total}
              </span>
            )}
            <span style={{ marginInlineStart: stats.total > 0 ? 6 : 0 }}>
              {subject ? `${verb}: ${subject}` : verb}
            </span>
          </div>
        );
      }
    }

    // No pluginState yet (args streaming or tool_use → tool_result gap):
    // fall back to a per-tool descriptive label sourced from args. Matches
    // TodoWriteInspector's `isArgumentsStreaming && stats.total === 0` branch.
    if (stats.total === 0) {
      const resolvedArgs = (args || partialArgs) as TaskInspectorArgs | undefined;
      const inFlight = isArgumentsStreaming || isLoading;
      const fallback = (() => {
        if (apiName === ClaudeCodeApiName.TaskUpdate) {
          const taskId = (resolvedArgs as TaskUpdateArgs | undefined)?.taskId;
          if (!taskId) return t('builtins.lobe-claude-code.todoWrite.todos');
          return t(
            inFlight
              ? 'builtins.lobe-claude-code.task.update.loading'
              : 'builtins.lobe-claude-code.task.update.completed',
            { taskId },
          );
        }
        return t(
          inFlight
            ? 'builtins.lobe-claude-code.task.list.loading'
            : 'builtins.lobe-claude-code.task.list.completed',
        );
      })();
      return (
        <div className={cx(inspectorTextStyles.root, inFlight && shinyTextStyles.shinyText)}>
          {fallback}
        </div>
      );
    }

    const label = stats.inProgress
      ? t('builtins.lobe-claude-code.todoWrite.currentStep')
      : allDone
        ? t('builtins.lobe-claude-code.todoWrite.allDone')
        : t('builtins.lobe-claude-code.todoWrite.todos');

    const detail = stats.inProgress
      ? stats.inProgress.text
      : !allDone
        ? `${stats.completed}/${stats.total}`
        : undefined;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <ProgressRing stats={stats} />
        <span>{label}</span>
        {detail && (
          <>
            <span>:</span>
            <span className={styles.chip}>{detail}</span>
          </>
        )}
      </div>
    );
  },
);

TaskInspector.displayName = 'ClaudeCodeTaskInspector';
