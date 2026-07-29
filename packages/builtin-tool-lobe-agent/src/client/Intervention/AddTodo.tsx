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
    // `args` originates from model tool-call output (and may be a partial parse
    // while streaming), so guard on Array.isArray rather than truthiness — a
    // truthy non-array value would otherwise flow through and crash `.map`.
    const defaultItems: TodoItem[] = Array.isArray(args?.items)
      ? args.items
      : Array.isArray(args?.adds)
        ? args.adds.map((text) => ({ status: 'todo', text }))
        : [];

    const handleSave = useCallback(
      async (items: TodoItem[]) => {
        await onArgsChange?.({ items });
      },
      [onArgsChange],
    );

    return (
      <Block variant={'outlined'}>
        <SortableTodoList
          defaultItems={defaultItems}
          placeholder={t('lobe-agent.addTodo.placeholder')}
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
