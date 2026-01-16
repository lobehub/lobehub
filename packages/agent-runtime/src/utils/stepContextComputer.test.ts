import { describe, expect, it } from 'vitest';

import { computeStepContext } from './stepContextComputer';

describe('computeStepContext', () => {
  describe('assembles stepContext from pre-computed values', () => {
    it('should include todos when provided', () => {
      const todos = {
        items: [
          { text: 'Buy milk', status: 'todo' as const },
          { text: 'Call mom', status: 'completed' as const },
        ],
        updatedAt: '2024-06-01T00:00:00.000Z',
      };

      const result = computeStepContext({ todos });

      expect(result.todos).toBeDefined();
      expect(result.todos?.items).toHaveLength(2);
      expect(result.todos?.items[0].text).toBe('Buy milk');
      expect(result.todos?.items[0].status).toBe('todo');
      expect(result.todos?.items[1].text).toBe('Call mom');
      expect(result.todos?.items[1].status).toBe('completed');
    });

    it('should not include todos key when undefined', () => {
      const result = computeStepContext({});

      expect(result.todos).toBeUndefined();
      expect('todos' in result).toBe(false);
    });

    it('should return empty object when no params provided', () => {
      const result = computeStepContext({});

      expect(result).toEqual({});
    });
  });

  describe('object parameter extensibility', () => {
    it('should accept object parameter for future extensibility', () => {
      // This should compile and work - object param allows future extensions
      const result = computeStepContext({
        todos: {
          items: [{ text: 'Task', status: 'todo' as const }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      expect(result).toBeDefined();
      expect(result.todos).toBeDefined();
    });
  });
});
