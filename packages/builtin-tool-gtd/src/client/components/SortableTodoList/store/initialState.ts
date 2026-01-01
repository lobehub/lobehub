import type { TodoListState } from './types';

export const initialState: Omit<TodoListState, 'items'> = {
  cursorPosition: 0,
  focusedId: null,
  isDirty: false,
  newItemText: '',
  saveStatus: 'idle',
};

// Auto-save configuration
export const AUTO_SAVE_DELAY = 3000; // 3 seconds after last change
export const AUTO_SAVE_MAX_WAIT = 10_000; // Maximum 10 seconds between saves
