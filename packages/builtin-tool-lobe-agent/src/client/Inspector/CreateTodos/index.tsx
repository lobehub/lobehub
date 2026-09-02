'use client';

import { TodoInspectorSummary } from '@lobechat/shared-tool-ui/components';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateTodosParams, CreateTodosState } from '../../../types';
import {
  computeTodoSummary,
  normalizeTodoItems,
  TODO_SUMMARY_LABEL_KEYS,
} from '../../components/todoSummary';

export const CreateTodosInspector = memo<
  BuiltinInspectorProps<CreateTodosParams, CreateTodosState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const summary = useMemo(() => {
    // Prefer the executed result state, then saved items, then streaming adds
    const stateItems = normalizeTodoItems(pluginState?.todos);
    if (stateItems.length > 0) return computeTodoSummary(stateItems);

    const items = args?.items || [];
    if (items.length > 0) return computeTodoSummary(items);

    const adds = args?.adds || partialArgs?.adds || [];
    return computeTodoSummary(adds.map((text) => ({ status: 'todo' as const, text })));
  }, [args, partialArgs, pluginState]);

  if (isArgumentsStreaming && summary.total === 0) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-agent.apiName.createTodos')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root}>
      <TodoInspectorSummary
        label={t(TODO_SUMMARY_LABEL_KEYS[summary.state])}
        shiny={isArgumentsStreaming || isLoading}
        summary={summary}
      />
    </div>
  );
});

CreateTodosInspector.displayName = 'CreateTodosInspector';

export default CreateTodosInspector;
