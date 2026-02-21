'use client';

import { useUnmount } from 'ahooks';
import { memo, useEffect, useMemo } from 'react';

import type { TodoItem } from '../../../types';
import { createTodoListStore, TodoListStoreContext } from './store';
import TodoList from './TodoList';

export type { TodoListItem } from './store';

export interface SortableTodoListProps {
  /**
   * Default items for initialization (TodoItem array)
   */
  defaultItems?: TodoItem[];
  /**
   * Callback when items change (debounced, 3s after last change)
   * This is called automatically after content changes
   */
  onSave?: (items: TodoItem[]) => void | Promise<void>;
  /**
   * Placeholder text for inputs
   */
  placeholder?: string;
  /**
   * Register a callback to flush pending saves before approval
   * Used by intervention components to ensure all edits are saved before approve action
   * @param id - Unique identifier for the callback
   * @param callback - The callback to execute
   * @returns Cleanup function to unregister
   */
  registerBeforeApprove?: (id: string, callback: () => void | Promise<void>) => () => void;
}

const SortableTodoList = memo<SortableTodoListProps>(
  ({ defaultItems = [], placeholder, onSave, registerBeforeApprove }) => {
    // Create store instance once with onSave callback
    const store = useMemo(() => createTodoListStore(defaultItems, onSave), []);

    // Register saveNow as beforeApprove callback (async, waits for save to complete)
    useEffect(() => {
      if (registerBeforeApprove) {
        const unregister = registerBeforeApprove('sortable-todo-list', async () => {
          console.log('trigger save');
          await store.getState().saveNow();
          console.log('trigger save successful');
        });
        // Cleanup: unregister on unmount
        return unregister;
      }
    }, [registerBeforeApprove, store]);

    // Flush pending saves on unmount to ensure no data loss
    useUnmount(() => {
      store.getState().flushSave();
    });

    return (
      <TodoListStoreContext value={store}>
        <TodoList placeholder={placeholder} />
      </TodoListStoreContext>
    );
  },
);

SortableTodoList.displayName = 'SortableTodoList';

export default SortableTodoList;
