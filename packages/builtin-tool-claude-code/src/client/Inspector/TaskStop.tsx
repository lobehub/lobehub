'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type TaskStopArgs } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
});

/**
 * CC's tool for terminating a background task. Falls back to the legacy
 * `shell_id` field when `task_id` is absent — older CC builds emitted that.
 */
export const TaskStopInspector = memo<BuiltinInspectorProps<TaskStopArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.TaskStop as any);
    const source = args ?? partialArgs;
    const taskId = (source?.task_id ?? source?.shell_id)?.trim();

    const isShiny = isArgumentsStreaming || isLoading;

    if (isArgumentsStreaming && !taskId) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(isShiny && shinyTextStyles.shinyText)}>
          {taskId ? `${label}:` : label}
        </span>
        {taskId && <span {...stylex.props(styles.chip)}>{taskId}</span>}
      </div>
    );
  },
);

TaskStopInspector.displayName = 'ClaudeCodeTaskStopInspector';
