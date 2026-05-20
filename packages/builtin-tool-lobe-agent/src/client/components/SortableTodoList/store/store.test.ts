import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TodoItem } from '../../../../types';
import { resetIdCounter } from './actions';
import { createTodoListStore } from './index';
import { ADD_ITEM_ID } from './types';

// Helper to create TodoItem array from text strings
const toTodoItems = (...texts: string[]): TodoItem[] =>
  texts.map((text) => ({ status: 'todo', text }));

describe('TodoListStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIdCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createTodoListStore', () => {
    it('should create store with empty items by default', () => {
      const store = createTodoListStore();
      const state = store.getState();

      expect(state.items).toEqual([]);
      expect(state.newItemText).toBe('');
      expect(state.focusedId).toBeNull();
      expect(state.cursorPosition).toBe(0);
      expect(state.isDirty).toBe(false);
      expect(state.saveStatus).toBe('idle');
    });

    it('should create store with default items', () => {
      const store = createTodoListStore(toTodoItems('Task 1', 'Task 2'));
      const state = store.getState();

      expect(state.items).toHaveLength(2);
      expect(state.items[0].text).toBe('Task 1');
      expect(state.items[0].status).toBe('todo');
      expect(state.items[1].text).toBe('Task 2');
    });

    it('should generate unique IDs for items', () => {
      const store = createTodoListStore(toTodoItems('Task 1', 'Task 2'));
      const state = store.getState();

      expect(state.items[0].id).not.toBe(state.items[1].id);
    });
  });

  describe('addItem', () => {
    it('should add a new item when newItemText is not empty', () => {
      const store = createTodoListStore();

      act(() => {
        store.getState().setNewItemText('New Task');
        store.getState().addItem();
      });

      const state = store.getState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].text).toBe('New Task');
      expect(state.items[0].status).toBe('todo');
      expect(state.newItemText).toBe('');
    });

    it('should not add item when newItemText is empty', () => {
      const store = createTodoListStore();

      act(() => {
        store.getState().setNewItemText('   ');
        store.getState().addItem();
      });

      expect(store.getState().items).toHaveLength(0);
    });

    it('should trim whitespace from new item text', () => {
      const store = createTodoListStore();

      act(() => {
        store.getState().setNewItemText('  Trimmed Task  ');
        store.getState().addItem();
      });

      expect(store.getState().items[0].text).toBe('Trimmed Task');
    });

    it('should mark store as dirty after adding item', () => {
      const store = createTodoListStore();

      act(() => {
        store.getState().setNewItemText('New Task');
        store.getState().addItem();
      });

      expect(store.getState().isDirty).toBe(true);
    });
  });

  describe('deleteItem', () => {
    it('should delete item by id', () => {
      const store = createTodoListStore(toTodoItems('Task 1', 'Task 2'));
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().deleteItem(itemId);
      });

      const state = store.getState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].text).toBe('Task 2');
    });

    it('should mark store as dirty after deleting item', () => {
      const store = createTodoListStore(toTodoItems('Task 1'));
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().deleteItem(itemId);
      });

      expect(store.getState().isDirty).toBe(true);
    });
  });

  describe('updateItem', () => {
    it('should update item text by id', () => {
      const store = createTodoListStore(toTodoItems('Task 1'));
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().updateItem(itemId, 'Updated Task');
      });

      expect(store.getState().items[0].text).toBe('Updated Task');
    });

    it('should mark store as dirty after updating item', () => {
      const store = createTodoListStore(toTodoItems('Task 1'));
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().updateItem(itemId, 'Updated Task');
      });

      expect(store.getState().isDirty).toBe(true);
    });
  });

  describe('toggleItem', () => {
    it('should cycle through status: todo → processing → completed → todo', () => {
      const store = createTodoListStore(toTodoItems('Task 1'));
      const itemId = store.getState().items[0].id;

      expect(store.getState().items[0].status).toBe('todo');

      act(() => {
        store.getState().toggleItem(itemId);
      });

      expect(store.getState().items[0].status).toBe('processing');

      act(() => {
        store.getState().toggleItem(itemId);
      });

      expect(store.getState().items[0].status).toBe('completed');

      act(() => {
        store.getState().toggleItem(itemId);
      });

      expect(store.getState().items[0].status).toBe('todo');
    });

    it('should mark store as dirty after toggling item', () => {
      const store = createTodoListStore(toTodoItems('Task 1'));
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().toggleItem(itemId);
      });

      expect(store.getState().isDirty).toBe(true);
    });
  });

  describe('sortItems', () => {
    it('should update items order', () => {
      const store = createTodoListStore(toTodoItems('Task 1', 'Task 2', 'Task 3'));
      const items = store.getState().items;
      const reversed = [...items].reverse();

      act(() => {
        store.getState().sortItems(reversed);
      });

      const state = store.getState();
      expect(state.items[0].text).toBe('Task 3');
      expect(state.items[1].text).toBe('Task 2');
      expect(state.items[2].text).toBe('Task 1');
    });

    it('should mark store as dirty after sorting', () => {
      const store = createTodoListStore(toTodoItems('Task 1', 'Task 2'));
      const items = store.getState().items;

      act(() => {
        store.getState().sortItems([...items].reverse());
      });

      expect(store.getState().isDirty).toBe(true);
    });
  });

  describe('focus navigation', () => {
    describe('focusNextItem', () => {
      it('should focus next item in list', () => {
        const store = createTodoListStore(toTodoItems('Task 1', 'Task 2', 'Task 3'));
        const items = store.getState().items;

        act(() => {
          store.getState().focusNextItem(items[0].id, 5);
        });

        expect(store.getState().focusedId).toBe(items[1].id);
        expect(store.getState().cursorPosition).toBe(5);
      });

      it('should focus ADD_ITEM_ID when at last item', () => {
        const store = createTodoListStore(toTodoItems('Task 1', 'Task 2'));
        const items = store.getState().items;

        act(() => {
          store.getState().focusNextItem(items[1].id, 3);
        });

        expect(store.getState().focusedId).toBe(ADD_ITEM_ID);
      });

      it('should not change focus when already at ADD_ITEM_ID', () => {
        const store = createTodoListStore(toTodoItems('Task 1'));

        act(() => {
          store.getState().setFocusedId(ADD_ITEM_ID);
          store.getState().focusNextItem(ADD_ITEM_ID, 0);
        });

        expect(store.getState().focusedId).toBe(ADD_ITEM_ID);
      });

      it('should not change focus when currentId is null', () => {
        const store = createTodoListStore(toTodoItems('Task 1'));

        act(() => {
          store.getState().focusNextItem(null, 0);
        });

        expect(store.getState().focusedId).toBeNull();
      });
    });

    describe('focusPrevItem', () => {
      it('should focus previous item in list', () => {
        const store = createTodoListStore(toTodoItems('Task 1', 'Task 2', 'Task 3'));
        const items = store.getState().items;

        act(() => {
          store.getState().focusPrevItem(items[2].id, 5);
        });

        expect(store.getState().focusedId).toBe(items[1].id);
        expect(store.getState().cursorPosition).toBe(5);
      });

      it('should not change focus when at first item', () => {
        const store = createTodoListStore(toTodoItems('Task 1', 'Task 2'));
        const items = store.getState().items;

        act(() => {
          store.getState().setFocusedId(items[0].id);
          store.getState().focusPrevItem(items[0].id, 0);
        });

        expect(store.getState().focusedId).toBe(items[0].id);
      });

      it('should focus last item when at ADD_ITEM_ID', () => {
        const store = createTodoListStore(toTodoItems('Task 1', 'Task 2'));
        const items = store.getState().items;

        act(() => {
          store.getState().focusPrevItem(ADD_ITEM_ID, 3);
        });

        expect(store.getState().focusedId).toBe(items[1].id);
      });

      it('should not change focus when items list is empty', () => {
        const store = createTodoListStore();

        act(() => {
          store.getState().focusPrevItem(ADD_ITEM_ID, 0);
        });

        expect(store.getState().focusedId).toBeNull();
      });
    });
  });

  describe('setFocusedId', () => {
    it('should set focused id', () => {
      const store = createTodoListStore(toTodoItems('Task 1'));
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().setFocusedId(itemId);
      });

      expect(store.getState().focusedId).toBe(itemId);
    });

    it('should set focused id to null', () => {
      const store = createTodoListStore(toTodoItems('Task 1'));
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().setFocusedId(itemId);
        store.getState().setFocusedId(null);
      });

      expect(store.getState().focusedId).toBeNull();
    });
  });

  describe('setNewItemText', () => {
    it('should set new item text', () => {
      const store = createTodoListStore();

      act(() => {
        store.getState().setNewItemText('New Task');
      });

      expect(store.getState().newItemText).toBe('New Task');
    });
  });

  describe('auto-save functionality', () => {
    it('should call onSave after debounce delay', async () => {
      const onSave = vi.fn();
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);

      act(() => {
        store.getState().updateItem(store.getState().items[0].id, 'Updated');
      });

      expect(onSave).not.toHaveBeenCalled();
      expect(store.getState().isDirty).toBe(true);

      // Fast-forward past debounce delay
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(onSave).toHaveBeenCalledTimes(1);
      // onSave receives TodoItem[] (without id), not TodoListItem[]
      expect(onSave).toHaveBeenCalledWith([{ status: 'todo', text: 'Updated' }]);
    });

    it('should set saveStatus to saving during save', async () => {
      const onSave = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);

      act(() => {
        store.getState().updateItem(store.getState().items[0].id, 'Updated');
      });

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(store.getState().saveStatus).toBe('saving');
    });

    it('should set saveStatus to saved after successful save', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);

      act(() => {
        store.getState().updateItem(store.getState().items[0].id, 'Updated');
      });

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(store.getState().saveStatus).toBe('saved');
      expect(store.getState().isDirty).toBe(false);
    });

    it('should set saveStatus to error on save failure', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);

      act(() => {
        store.getState().updateItem(store.getState().items[0].id, 'Updated');
      });

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(store.getState().saveStatus).toBe('error');
    });

    it('should debounce multiple rapid changes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);
      const itemId = store.getState().items[0].id;

      act(() => {
        store.getState().updateItem(itemId, 'Update 1');
      });

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      act(() => {
        store.getState().updateItem(itemId, 'Update 2');
      });

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      act(() => {
        store.getState().updateItem(itemId, 'Update 3');
      });

      expect(onSave).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('should flush save immediately when flushSave is called', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);

      act(() => {
        store.getState().updateItem(store.getState().items[0].id, 'Updated');
      });

      expect(onSave).not.toHaveBeenCalled();

      await act(async () => {
        store.getState().flushSave();
        await Promise.resolve();
      });

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('should not call onSave if not dirty', async () => {
      const onSave = vi.fn();
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);

      await act(async () => {
        store.getState().flushSave();
        await Promise.resolve();
      });

      expect(onSave).not.toHaveBeenCalled();
    });

    it('should not call onSave if no onSave callback provided', async () => {
      const store = createTodoListStore(toTodoItems('Task 1'));

      act(() => {
        store.getState().updateItem(store.getState().items[0].id, 'Updated');
      });

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      // Should not throw or cause issues
      expect(store.getState().isDirty).toBe(true);
    });

    it('should reset saveStatus to idle after showing saved', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const store = createTodoListStore(toTodoItems('Task 1'), onSave);

      act(() => {
        store.getState().updateItem(store.getState().items[0].id, 'Updated');
      });

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
      });

      expect(store.getState().saveStatus).toBe('saved');

      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      expect(store.getState().saveStatus).toBe('idle');
    });
  });
});
