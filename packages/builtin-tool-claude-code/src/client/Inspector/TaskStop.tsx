'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type TaskStopArgs } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 60%;
    margin-inline-start: 6px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
}));

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
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <span>{taskId ? `${label}:` : label}</span>
        {taskId && <span className={styles.chip}>{taskId}</span>}
      </div>
    );
  },
);

TaskStopInspector.displayName = 'ClaudeCodeTaskStopInspector';
