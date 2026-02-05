'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Block } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateTodosParams, TodoItem } from '../../types';
import { SortableTodoList } from '../components';

const AddTodoIntervention = memo<BuiltinInterventionProps<CreateTodosParams>>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    const { t } = useTranslation('tool');

    // Handle both formats:
    // - Initial AI input: { adds: string[] } (from AI)
    // - After user edit: { items: TodoItem[] } (saved format)
    const defaultItems: TodoItem[] =
      args?.items || args?.adds?.map((text) => ({ status: 'todo', text })) || [];

    const handleSave = useCallback(
      async (items: TodoItem[]) => {
        console.log('[AddTodoIntervention] handleSave called with', items.length, 'items');
        await onArgsChange?.({ items });
        console.log('[AddTodoIntervention] onArgsChange completed');
      },
      [onArgsChange],
    );

    return (
      <Block variant={'outlined'}>
        <SortableTodoList
          defaultItems={defaultItems}
          placeholder={t('lobe-gtd.addTodo.placeholder')}
          registerBeforeApprove={registerBeforeApprove}
          onSave={handleSave}
        />
      </Block>
    );
  },
  isEqual,
);

AddTodoIntervention.displayName = 'AddTodoIntervention';

export default AddTodoIntervention;
