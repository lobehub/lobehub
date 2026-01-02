import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { gtdExecutor } from './index';

describe('GTDExecutor', () => {
  const createMockContext = (pluginState?: Record<string, unknown>): BuiltinToolContext => ({
    messageId: 'test-message-id',
    operationId: 'test-operation-id',
    pluginState,
  });

  describe('createTodos', () => {
    it('should add items to empty todo list using adds (AI input)', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.createTodos({ adds: ['Buy milk', 'Call mom'] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Added 2 items');
      expect(result.content).toContain('Buy milk');
      expect(result.content).toContain('Call mom');
      expect(result.state?.todos.items).toHaveLength(2);
      expect(result.state?.todos.items[0].text).toBe('Buy milk');
      expect(result.state?.todos.items[0].completed).toBe(false);
      expect(result.state?.todos.items[1].text).toBe('Call mom');
    });

    it('should add items using items (user-edited format)', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.createTodos(
        {
          items: [
            { text: 'Buy milk', completed: false },
            { text: 'Call mom', completed: true },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain('Added 2 items');
      expect(result.state?.todos.items).toHaveLength(2);
      expect(result.state?.todos.items[0].text).toBe('Buy milk');
      expect(result.state?.todos.items[0].completed).toBe(false);
      expect(result.state?.todos.items[1].text).toBe('Call mom');
      expect(result.state?.todos.items[1].completed).toBe(true);
    });

    it('should append items to existing todo list', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Existing task', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.createTodos({ adds: ['New task'] }, ctx);

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(2);
      expect(result.state?.todos.items[0].text).toBe('Existing task');
      expect(result.state?.todos.items[1].text).toBe('New task');
    });

    it('should return error when no items provided', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.createTodos({ adds: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('No items provided');
    });

    it('should add single item with correct singular grammar', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.createTodos({ adds: ['Single task'] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Added 1 item');
      expect(result.content).not.toContain('items');
    });

    it('should prioritize items over adds when both provided', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.createTodos(
        {
          adds: ['AI task'],
          items: [{ text: 'User edited task', completed: true }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('User edited task');
      expect(result.state?.todos.items[0].completed).toBe(true);
    });
  });

  describe('updateTodos', () => {
    it('should add new items via operations', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Existing task', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.updateTodos(
        {
          operations: [{ type: 'add', text: 'New task' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(2);
      expect(result.state?.todos.items[1].text).toBe('New task');
    });

    it('should update item text via operations', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Old task', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.updateTodos(
        {
          operations: [{ type: 'update', index: 0, newText: 'Updated task' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state?.todos.items[0].text).toBe('Updated task');
    });

    it('should complete items via operations', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Task', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.updateTodos(
        {
          operations: [{ type: 'complete', index: 0 }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state?.todos.items[0].completed).toBe(true);
    });

    it('should remove items via operations', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: false },
          ],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.updateTodos(
        {
          operations: [{ type: 'remove', index: 0 }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('Task 2');
    });

    it('should return error when no operations provided', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.updateTodos({ operations: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('No operations provided');
    });

    it('should handle complete operations with out-of-range indices gracefully', async () => {
      // Test case: 5 items (indices 0-4), operations reference index 5 (out of range) and index 2 (valid)
      const ctx = createMockContext({
        createdItems: ['Task A', 'Task B', 'Task C', 'Task D', 'Task E'],
        todos: {
          items: [
            { completed: false, text: 'Task A' },
            { completed: false, text: 'Task B' },
            { completed: false, text: 'Task C' },
            { completed: false, text: 'Task D' },
            { completed: false, text: 'Task E' },
          ],
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.updateTodos(
        {
          operations: [
            { completed: true, index: 5, newText: '', text: '', type: 'complete' }, // out of range
            { completed: true, index: 2, newText: '', text: '', type: 'complete' }, // valid
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      // Should have all 5 items preserved
      expect(result.state?.todos.items).toHaveLength(5);
      // Index 5 is out of range (0-4), so should be skipped
      // Index 2 should be completed
      expect(result.state?.todos.items[2].completed).toBe(true);
      // Other items should remain uncompleted
      expect(result.state?.todos.items[0].completed).toBe(false);
      expect(result.state?.todos.items[1].completed).toBe(false);
      expect(result.state?.todos.items[3].completed).toBe(false);
      expect(result.state?.todos.items[4].completed).toBe(false);
    });
  });

  describe('completeTodos', () => {
    it('should mark items as done by indices', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: false },
            { text: 'Task 3', completed: false },
          ],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.completeTodos({ indices: [0, 2] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Completed 2 items');
      expect(result.state?.todos.items[0].completed).toBe(true);
      expect(result.state?.todos.items[1].completed).toBe(false);
      expect(result.state?.todos.items[2].completed).toBe(true);
    });

    it('should return error when no indices provided', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.completeTodos({ indices: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('No indices provided');
    });

    it('should handle empty todo list', async () => {
      const ctx = createMockContext({
        todos: { items: [], updatedAt: '2024-01-01T00:00:00.000Z' },
      });

      const result = await gtdExecutor.completeTodos({ indices: [0] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('No todos to complete');
    });

    it('should return error when all indices are invalid', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Task 1', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.completeTodos({ indices: [5, 10] }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('Invalid indices');
    });

    it('should complete valid indices and warn about invalid ones', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: false },
          ],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.completeTodos({ indices: [0, 99] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Completed 1 item');
      expect(result.content).toContain('Ignored invalid indices');
      expect(result.state?.todos.items[0].completed).toBe(true);
      expect(result.state?.todos.items[1].completed).toBe(false);
    });

    it('should handle single item completion with correct grammar', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Task 1', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.completeTodos({ indices: [0] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Completed 1 item');
      expect(result.content).not.toContain('items');
    });
  });

  describe('removeTodos', () => {
    it('should remove items by indices', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: false },
            { text: 'Task 3', completed: false },
          ],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.removeTodos({ indices: [0, 2] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Removed 2 items');
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('Task 2');
    });

    it('should return error when no indices provided', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.removeTodos({ indices: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('No indices provided');
    });

    it('should handle empty todo list', async () => {
      const ctx = createMockContext({
        todos: { items: [], updatedAt: '2024-01-01T00:00:00.000Z' },
      });

      const result = await gtdExecutor.removeTodos({ indices: [0] }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('No todos to remove');
    });
  });

  describe('clearTodos', () => {
    it('should clear all items when mode is "all"', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: true },
          ],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.clearTodos({ mode: 'all' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Cleared all 2 items');
      expect(result.state?.todos.items).toHaveLength(0);
    });

    it('should clear only completed items when mode is "completed"', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: true },
            { text: 'Task 3', completed: true },
          ],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.clearTodos({ mode: 'completed' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Cleared 2 completed items');
      // New format shows "1 pending" instead of "1 item remaining"
      expect(result.content).toContain('1 pending');
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('Task 1');
    });

    it('should handle empty todo list', async () => {
      const ctx = createMockContext({
        todos: { items: [], updatedAt: '2024-01-01T00:00:00.000Z' },
      });

      const result = await gtdExecutor.clearTodos({ mode: 'all' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('already empty');
    });

    it('should handle no completed items to clear', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Task 1', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.clearTodos({ mode: 'completed' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('No completed items to clear');
      expect(result.state?.todos.items).toHaveLength(1);
    });
  });

  describe('stepContext priority', () => {
    it('should prioritize stepContext.todos over pluginState.todos', async () => {
      // Create context with both stepContext and pluginState
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        pluginState: {
          todos: {
            items: [{ text: 'Old task from pluginState', completed: false }],
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        },
        stepContext: {
          todos: {
            items: [{ text: 'New task from stepContext', completed: true }],
            updatedAt: '2024-06-01T00:00:00.000Z',
          },
        },
      };

      // createTodos should use stepContext.todos as base
      const result = await gtdExecutor.createTodos({ adds: ['Another task'] }, ctx);

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(2);
      // First item should be from stepContext, not pluginState
      expect(result.state?.todos.items[0].text).toBe('New task from stepContext');
      expect(result.state?.todos.items[0].completed).toBe(true);
      expect(result.state?.todos.items[1].text).toBe('Another task');
    });

    it('should fallback to pluginState.todos when stepContext.todos is undefined', async () => {
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        pluginState: {
          todos: {
            items: [{ text: 'Task from pluginState', completed: false }],
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        },
        stepContext: {
          // No todos in stepContext
        },
      };

      const result = await gtdExecutor.createTodos({ adds: ['New task'] }, ctx);

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(2);
      expect(result.state?.todos.items[0].text).toBe('Task from pluginState');
      expect(result.state?.todos.items[1].text).toBe('New task');
    });

    it('should start with empty todos when both stepContext and pluginState are empty', async () => {
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        stepContext: {},
      };

      const result = await gtdExecutor.createTodos({ adds: ['First task'] }, ctx);

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('First task');
    });

    it('should work with stepContext.todos for completeTodos', async () => {
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        stepContext: {
          todos: {
            items: [
              { text: 'Task 1', completed: false },
              { text: 'Task 2', completed: false },
            ],
            updatedAt: '2024-06-01T00:00:00.000Z',
          },
        },
      };

      const result = await gtdExecutor.completeTodos({ indices: [0] }, ctx);

      expect(result.success).toBe(true);
      expect(result.state?.todos.items[0].completed).toBe(true);
      expect(result.state?.todos.items[1].completed).toBe(false);
    });

    it('should work with stepContext.todos for removeTodos', async () => {
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        stepContext: {
          todos: {
            items: [
              { text: 'Task 1', completed: false },
              { text: 'Task 2', completed: false },
            ],
            updatedAt: '2024-06-01T00:00:00.000Z',
          },
        },
      };

      const result = await gtdExecutor.removeTodos({ indices: [0] }, ctx);

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('Task 2');
    });

    it('should work with stepContext.todos for clearTodos', async () => {
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        stepContext: {
          todos: {
            items: [
              { text: 'Task 1', completed: true },
              { text: 'Task 2', completed: false },
            ],
            updatedAt: '2024-06-01T00:00:00.000Z',
          },
        },
      };

      const result = await gtdExecutor.clearTodos({ mode: 'completed' }, ctx);

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('Task 2');
    });
  });

  describe('executor metadata', () => {
    it('should have correct identifier', () => {
      expect(gtdExecutor.identifier).toBe('lobe-gtd');
    });

    it('should support all MVP APIs', () => {
      expect(gtdExecutor.hasApi('createTodos')).toBe(true);
      expect(gtdExecutor.hasApi('updateTodos')).toBe(true);
      expect(gtdExecutor.hasApi('completeTodos')).toBe(true);
      expect(gtdExecutor.hasApi('removeTodos')).toBe(true);
      expect(gtdExecutor.hasApi('clearTodos')).toBe(true);
    });

    it('should not support non-MVP APIs', () => {
      expect(gtdExecutor.hasApi('createPlan')).toBe(false);
      expect(gtdExecutor.hasApi('updatePlan')).toBe(false);
    });

    it('should return correct API names', () => {
      const apiNames = gtdExecutor.getApiNames();
      expect(apiNames).toContain('createTodos');
      expect(apiNames).toContain('updateTodos');
      expect(apiNames).toContain('completeTodos');
      expect(apiNames).toContain('removeTodos');
      expect(apiNames).toContain('clearTodos');
      expect(apiNames).toHaveLength(5);
    });
  });
});
