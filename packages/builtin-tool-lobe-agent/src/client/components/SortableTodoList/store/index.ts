import { createContext, useContext } from 'react';
import type { StoreApi } from 'zustand';
import { createStore, useStore } from 'zustand';

import type { TodoItem } from '../../../../types';
import { createActions } from './actions';
import type { StoreInternals, TodoListStore } from './types';

export type { TodoListItem, TodoListStore } from './types';
export { ADD_ITEM_ID } from './types';

export const createTodoListStore = (
  defaultItems: TodoItem[] = [],
  onSave?: (items: TodoItem[]) => void | Promise<void>,
) => {
  // Internal state for debounce (not part of zustand state)
  const internals: StoreInternals = {
    debouncedSave: null,
    onSave: onSave ?? null,
  };

  const store = createStore<TodoListStore>((set, get) => {
    return createActions(set, get, internals, defaultItems);
  });

  return store;
};

// Context for the store
export const TodoListStoreContext = createContext<StoreApi<TodoListStore> | null>(null);

// Hook to use the store
export const useTodoListStore = <T>(selector: (state: TodoListStore) => T): T => {
  const store = useContext(TodoListStoreContext);
  if (!store) {
    throw new Error('useTodoListStore must be used within TodoListStoreContext.Provider');
  }
  return useStore(store, selector);
};
