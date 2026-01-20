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
      expect(result.state?.todos.items[0].status).toBe('todo');
      expect(result.state?.todos.items[1].text).toBe('Call mom');
    });

    it('should add items using items (user-edited format)', async () => {
      const ctx = createMockContext();

      const result = await gtdExecutor.createTodos(
        {
          items: [
            { text: 'Buy milk', status: 'todo' },
            { text: 'Call mom', status: 'completed' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain('Added 2 items');
      expect(result.state?.todos.items).toHaveLength(2);
      expect(result.state?.todos.items[0].text).toBe('Buy milk');
      expect(result.state?.todos.items[0].status).toBe('todo');
      expect(result.state?.todos.items[1].text).toBe('Call mom');
      expect(result.state?.todos.items[1].status).toBe('completed');
    });

    it('should append items to existing todo list', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Existing task', status: 'todo' }],
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
          items: [{ text: 'User edited task', status: 'completed' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state?.todos.items).toHaveLength(1);
      expect(result.state?.todos.items[0].text).toBe('User edited task');
      expect(result.state?.todos.items[0].status).toBe('completed');
    });
  });

  describe('updateTodos', () => {
    it('should add new items via operations', async () => {
      const ctx = createMockContext({
        todos: {
          items: [{ text: 'Existing task', status: 'todo' }],
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
          items: [{ text: 'Old task', status: 'todo' }],
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
          items: [{ text: 'Task', status: 'todo' }],
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
      expect(result.state?.todos.items[0].status).toBe('completed');
    });

    it('should remove items via operations', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', status: 'todo' },
            { text: 'Task 2', status: 'todo' },
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
            { status: 'todo', text: 'Task A' },
            { status: 'todo', text: 'Task B' },
            { status: 'todo', text: 'Task C' },
            { status: 'todo', text: 'Task D' },
            { status: 'todo', text: 'Task E' },
          ],
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      });

      const result = await gtdExecutor.updateTodos(
        {
          operations: [
            { index: 5, type: 'complete' }, // out of range
            { index: 2, type: 'complete' }, // valid
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      // Should have all 5 items preserved
      expect(result.state?.todos.items).toHaveLength(5);
      // Index 5 is out of range (0-4), so should be skipped
      // Index 2 should be completed
      expect(result.state?.todos.items[2].status).toBe('completed');
      // Other items should remain uncompleted
      expect(result.state?.todos.items[0].status).toBe('todo');
      expect(result.state?.todos.items[1].status).toBe('todo');
      expect(result.state?.todos.items[3].status).toBe('todo');
      expect(result.state?.todos.items[4].status).toBe('todo');
    });
  });

  describe('clearTodos', () => {
    it('should clear all items when mode is "all"', async () => {
      const ctx = createMockContext({
        todos: {
          items: [
            { text: 'Task 1', status: 'todo' },
            { text: 'Task 2', status: 'completed' },
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
            { text: 'Task 1', status: 'todo' },
            { text: 'Task 2', status: 'completed' },
            { text: 'Task 3', status: 'completed' },
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
          items: [{ text: 'Task 1', status: 'todo' }],
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
            items: [{ text: 'Old task from pluginState', status: 'todo' }],
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        },
        stepContext: {
          todos: {
            items: [{ text: 'New task from stepContext', status: 'completed' }],
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
      expect(result.state?.todos.items[0].status).toBe('completed');
      expect(result.state?.todos.items[1].text).toBe('Another task');
    });

    it('should fallback to pluginState.todos when stepContext.todos is undefined', async () => {
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        pluginState: {
          todos: {
            items: [{ text: 'Task from pluginState', status: 'todo' }],
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

    it('should work with stepContext.todos for clearTodos', async () => {
      const ctx: BuiltinToolContext = {
        messageId: 'test-message-id',
        operationId: 'test-operation-id',
        stepContext: {
          todos: {
            items: [
              { text: 'Task 1', status: 'completed' },
              { text: 'Task 2', status: 'todo' },
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

    it('should support all APIs', () => {
      expect(gtdExecutor.hasApi('createTodos')).toBe(true);
      expect(gtdExecutor.hasApi('updateTodos')).toBe(true);
      expect(gtdExecutor.hasApi('clearTodos')).toBe(true);
      expect(gtdExecutor.hasApi('createPlan')).toBe(true);
      expect(gtdExecutor.hasApi('updatePlan')).toBe(true);
      expect(gtdExecutor.hasApi('execTask')).toBe(true);
      expect(gtdExecutor.hasApi('execTasks')).toBe(true);
    });

    it('should return correct API names', () => {
      const apiNames = gtdExecutor.getApiNames();
      expect(apiNames).toContain('createTodos');
      expect(apiNames).toContain('updateTodos');
      expect(apiNames).toContain('clearTodos');
      expect(apiNames).toContain('createPlan');
      expect(apiNames).toContain('updatePlan');
      expect(apiNames).toContain('execTask');
      expect(apiNames).toContain('execTasks');
      expect(apiNames).toHaveLength(7);
    });
  });
});
