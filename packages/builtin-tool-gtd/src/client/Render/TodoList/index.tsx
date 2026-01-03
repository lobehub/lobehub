'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Block, Checkbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import type { TodoItem, TodoList as TodoListType } from '../../../types';

export interface TodoListRenderState {
  todos?: TodoListType;
}

// Styles matching TodoItemRow in SortableTodoList
const styles = createStaticStyles(({ css, cssVar }) => ({
  itemRow: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  textChecked: css`
    color: ${cssVar.colorTextQuaternary};
    text-decoration: line-through;
  `,
}));

interface ReadOnlyTodoItemProps {
  completed: boolean;
  text: string;
}

/**
 * Read-only todo item row, matching the style of TodoItemRow in SortableTodoList
 */
const ReadOnlyTodoItem = memo<ReadOnlyTodoItemProps>(({ text, completed }) => {
  return (
    <Checkbox
      backgroundColor={cssVar.colorSuccess}
      checked={completed}
      classNames={{ text: completed ? styles.textChecked : undefined, wrapper: styles.itemRow }}
      shape={'circle'}
      style={{ borderWidth: 1.5, cursor: 'default' }}
      textProps={{
        type: completed ? 'secondary' : undefined,
      }}
    >
      {text}
    </Checkbox>
  );
});

ReadOnlyTodoItem.displayName = 'ReadOnlyTodoItem';

interface TodoListUIProps {
  items: TodoItem[];
}

/**
 * Read-only TodoList UI component
 * Displays todo items in a style matching the editable SortableTodoList
 */
const TodoListUI = memo<TodoListUIProps>(({ items }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    // Outer container with background - matches AddTodoIntervention
    <Block variant={'outlined'} width="100%">
      {items.map((item, index) => (
        <ReadOnlyTodoItem completed={item.completed} key={index} text={item.text} />
      ))}
    </Block>
  );
});

TodoListUI.displayName = 'TodoListUI';

/**
 * TodoList Render component for GTD tool
 * Read-only display of todo items matching the style of AddTodoIntervention
 */
const TodoListRender = memo<BuiltinRenderProps<unknown, TodoListRenderState>>(({ pluginState }) => {
  const todos = pluginState?.todos;
  const items: TodoItem[] = todos?.items || [];

  return <TodoListUI items={items} />;
});

TodoListRender.displayName = 'TodoListRender';

export default TodoListRender;
export { TodoListUI };
