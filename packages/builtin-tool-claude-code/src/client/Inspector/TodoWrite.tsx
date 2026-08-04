'use client';

import { TodoInspectorSummary } from '@lobechat/shared-tool-ui/components';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type TodoWriteArgs } from '../../types';
import { computeTodoSummary, TODO_SUMMARY_LABEL_KEYS } from '../todoSummary';

export const TodoWriteInspector = memo<BuiltinInspectorProps<TodoWriteArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const summary = useMemo(() => computeTodoSummary(args || partialArgs), [args, partialArgs]);
    const label = t(TODO_SUMMARY_LABEL_KEYS[summary.state]);

    if (isArgumentsStreaming && summary.total === 0) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <TodoInspectorSummary label={label} summary={summary} />
      </div>
    );
  },
);

TodoWriteInspector.displayName = 'ClaudeCodeTodoWriteInspector';
