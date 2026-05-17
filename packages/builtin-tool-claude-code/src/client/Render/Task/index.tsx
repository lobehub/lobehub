'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Checkbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleArrowRight, CircleCheckBig, CircleX, ListTodo, RotateCcw } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type TaskUpdateArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
  itemRow: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  processingRow: css`
    display: flex;
    gap: 7px;
    align-items: center;
  `,
  textCompleted: css`
    color: ${cssVar.colorTextQuaternary};
    text-decoration: line-through;
  `,
  textPending: css`
    color: ${cssVar.colorTextSecondary};
  `,
  textProcessing: css`
    color: ${cssVar.colorText};
  `,
}));

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

interface TaskRowProps {
  item: TaskPluginStateItem;
}

const TaskRow = memo<TaskRowProps>(({ item }) => {
  const { status, text } = item;

  if (status === 'processing') {
    return (
      <div className={cx(styles.itemRow, styles.processingRow)}>
        <Icon icon={CircleArrowRight} size={17} style={{ color: cssVar.colorInfo }} />
        <span className={styles.textProcessing}>{text}</span>
      </div>
    );
  }

  const isCompleted = status === 'completed';

  return (
    <Checkbox
      backgroundColor={cssVar.colorSuccess}
      checked={isCompleted}
      shape={'circle'}
      style={{ borderWidth: 1.5, cursor: 'default' }}
      classNames={{
        text: cx(styles.textPending, isCompleted && styles.textCompleted),
        wrapper: styles.itemRow,
      }}
      textProps={{
        type: isCompleted ? 'secondary' : undefined,
      }}
    >
      {text}
    </Checkbox>
  );
});

TaskRow.displayName = 'ClaudeCodeTaskRow';

/**
 * Per-call override that swaps the header into a status-flip readout
 * ("Completed: Read hosts") when the panel is rendered for a TaskUpdate.
 * Computed by the Task component from `apiName` + `args` so TaskHeader
 * stays a pure presentational component.
 *
 * `label` is the verb shown before `:`, `detail` is the subject; both
 * are pre-localized strings (no i18n inside TaskHeader for overrides).
 */
interface TaskHeaderOverride {
  color: string;
  detail?: string;
  icon: typeof CircleArrowRight;
  label: string;
}

interface TaskHeaderProps {
  completed: number;
  inProgress?: TaskPluginStateItem;
  override?: TaskHeaderOverride;
  total: number;
}

const TaskHeader = memo<TaskHeaderProps>(({ completed, total, inProgress, override }) => {
  const { t } = useTranslation('plugin');
  const allDone = total > 0 && completed === total;

  const icon =
    override?.icon ?? (inProgress ? CircleArrowRight : allDone ? CircleCheckBig : ListTodo);
  const color =
    override?.color ??
    (inProgress ? cssVar.colorInfo : allDone ? cssVar.colorSuccess : cssVar.colorTextSecondary);

  const label =
    override?.label ??
    (inProgress
      ? t('builtins.lobe-claude-code.todoWrite.currentStep')
      : allDone
        ? t('builtins.lobe-claude-code.todoWrite.allDone')
        : t('builtins.lobe-claude-code.todoWrite.todos'));
  const detail = override ? override.detail : inProgress?.text;

  return (
    <div className={styles.header}>
      <Icon icon={icon} size={16} style={{ color, flexShrink: 0 }} />
      <div className={styles.headerLabel}>
        <span>{label}</span>
        {detail && (
          <>
            <span>: </span>
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

TaskHeader.displayName = 'ClaudeCodeTaskHeader';

/**
 * Panel render for CC 2.1.143+ task tools (TaskCreate / TaskUpdate / TaskList).
 *
 * Reads the **adapter-synthesized** `pluginState.todos.items` snapshot — the
 * same source consumed by `selectTodosFromMessages`. Each per-call args
 * carries only a delta, so the panel can't be built from args alone; the
 * accumulator's snapshot is the source of truth.
 *
 * Returns `null` when the snapshot is absent or empty (typical for a fresh
 * TaskList before any creates, or a TaskUpdate that failed).
 *
 * Header behaviour:
 *  - Default (TaskCreate / TaskList / TaskUpdate without status): shows the
 *    standard `currentStep / allDone / todos` aggregate label so the panel
 *    stays visually consistent with legacy TodoWrite sessions.
 *  - TaskUpdate with `args.status`: the per-call signal IS that status flip,
 *    so the header mirrors the chip ("Completed: Read hosts") instead of
 *    burying it under the aggregate. Subject is resolved from pluginState
 *    by id; `args.subject` is the resume-gap fallback.
 */
const Task = memo<BuiltinRenderProps<TaskUpdateArgs | undefined, TaskPluginState>>(
  ({ apiName, args, pluginState }) => {
    const items = pluginState?.todos?.items;
    const { t } = useTranslation('plugin');

    const stats = useMemo(() => {
      const list = items ?? [];
      return {
        completed: list.filter((item) => item.status === 'completed').length,
        inProgress: list.find((item) => item.status === 'processing'),
        total: list.length,
      };
    }, [items]);

    const override = useMemo<TaskHeaderOverride | undefined>(() => {
      if (apiName !== ClaudeCodeApiName.TaskUpdate || !args?.status) return undefined;
      const { status, taskId, subject: argsSubject } = args;
      const resolvedSubject =
        (taskId ? items?.find((item) => item.id === taskId)?.text : undefined) ?? argsSubject;
      const map = {
        completed: {
          color: cssVar.colorSuccess,
          icon: CircleCheckBig,
          label: t('builtins.lobe-claude-code.task.updateCompleted'),
        },
        deleted: {
          color: cssVar.colorError,
          icon: CircleX,
          label: t('builtins.lobe-claude-code.task.updateDeleted'),
        },
        in_progress: {
          color: cssVar.colorInfo,
          icon: CircleArrowRight,
          label: t('builtins.lobe-claude-code.task.updateInProgress'),
        },
        pending: {
          color: cssVar.colorTextSecondary,
          icon: RotateCcw,
          label: t('builtins.lobe-claude-code.task.updatePending'),
        },
      } as const;
      const entry = map[status];
      return { ...entry, detail: resolvedSubject };
    }, [apiName, args, items, t]);

    if (!items || items.length === 0) return null;

    return (
      <Block variant={'outlined'} width="100%">
        <TaskHeader
          completed={stats.completed}
          inProgress={stats.inProgress}
          override={override}
          total={stats.total}
        />
        {items.map((item, index) => (
          <TaskRow item={item} key={index} />
        ))}
      </Block>
    );
  },
);

Task.displayName = 'ClaudeCodeTask';

export default Task;
