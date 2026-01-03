import { describe, expect, it } from 'vitest';

import { computeStepContext } from './stepContextComputer';

describe('computeStepContext', () => {
  describe('assembles stepContext from pre-computed values', () => {
    it('should include todos when provided', () => {
      const todos = {
        items: [
          { text: 'Buy milk', completed: false },
          { text: 'Call mom', completed: true },
        ],
        updatedAt: '2024-06-01T00:00:00.000Z',
      };

      const result = computeStepContext({ todos });

      expect(result.todos).toBeDefined();
      expect(result.todos?.items).toHaveLength(2);
      expect(result.todos?.items[0].text).toBe('Buy milk');
      expect(result.todos?.items[0].completed).toBe(false);
      expect(result.todos?.items[1].text).toBe('Call mom');
      expect(result.todos?.items[1].completed).toBe(true);
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
          items: [{ text: 'Task', completed: false }],
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      expect(result).toBeDefined();
      expect(result.todos).toBeDefined();
    });
  });
});
