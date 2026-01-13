'use client';

import { SortableList } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import AddItemRow from './AddItemRow';
import SortableItem from './SortableItem';
import { TodoListItem, useTodoListStore } from './store';

interface TodoListProps {
  placeholder?: string;
}

const TodoList = memo<TodoListProps>(({ placeholder }) => {
  const items = useTodoListStore((s) => s.items);
  const sortItems = useTodoListStore((s) => s.sortItems);

  const handleSortEnd = useCallback(
    (sorted: unknown[]) => {
      sortItems(sorted as TodoListItem[]);
    },
    [sortItems],
  );

  const renderItem = useCallback(
    (item: TodoListItem) => {
      return <SortableItem id={item.id} placeholder={placeholder} />;
    },
    [placeholder],
  );

  // Empty state
  if (items.length === 0) {
    return <AddItemRow placeholder={placeholder} showDragHandle={false} />;
  }

  // Use items length as key to force remount when items change structure
  // This fixes DragOverlay position issues after drag operations
  const listKey = items.map((i) => i.id).join('-');

  return (
    <>
      <SortableList
        gap={0}
        items={items}
        key={listKey}
        onChange={handleSortEnd}
        renderItem={renderItem}
        style={{ marginBottom: 0 }}
      />
      <AddItemRow placeholder={placeholder} />
    </>
  );
});

TodoList.displayName = 'TodoList';

export default TodoList;
