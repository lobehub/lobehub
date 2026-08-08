'use client';

import { TodoInspectorSummary } from '@lobechat/shared-tool-ui/components';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateTodosParams, UpdateTodosState } from '../../../types';
import {
  computeTodoSummary,
  normalizeTodoItems,
  TODO_SUMMARY_LABEL_KEYS,
} from '../../components/todoSummary';

export const UpdateTodosInspector = memo<
  BuiltinInspectorProps<UpdateTodosParams, UpdateTodosState>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  // The full todo list only exists after execution (pluginState.todos);
  // while arguments stream in we just show the tool name.
  const summary = useMemo(
    () => computeTodoSummary(normalizeTodoItems(pluginState?.todos)),
    [pluginState?.todos],
  );

  const shiny = (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText;

  if (summary.total === 0) {
    return (
      <div className={cx(inspectorTextStyles.root, shiny)}>
        <span>{t('builtins.lobe-agent.apiName.updateTodos')}</span>
      </div>
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, shiny)}>
      <TodoInspectorSummary label={t(TODO_SUMMARY_LABEL_KEYS[summary.state])} summary={summary} />
    </div>
  );
});

UpdateTodosInspector.displayName = 'UpdateTodosInspector';

export default UpdateTodosInspector;
