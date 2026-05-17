'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskGetArgs } from '../../types';

/**
 * TaskGet is read-only — the adapter doesn't synthesize `pluginState.todos`
 * for it (only TaskCreate / TaskUpdate / TaskList mutate the accumulator).
 * Render just enough to identify which task was inspected.
 */
export const TaskGetInspector = memo<BuiltinInspectorProps<TaskGetArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const taskId = args?.taskId ?? partialArgs?.taskId;

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        {t('builtins.lobe-claude-code.task.getLabel', { taskId: taskId ?? '' })}
      </div>
    );
  },
);

TaskGetInspector.displayName = 'ClaudeCodeTaskGetInspector';
