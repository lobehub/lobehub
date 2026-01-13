import { describe, expect, it } from 'vitest';

import { formatTodoStateSummary } from './index';

describe('formatTodoStateSummary', () => {
  it('should format empty todo list', () => {
    expect(formatTodoStateSummary([])).toMatchInlineSnapshot(`"📋 Current Todo List: (empty)"`);
  });

  it('should format empty todo list with timestamp', () => {
    expect(formatTodoStateSummary([], '2025-01-15T10:30:00.000Z')).toMatchInlineSnapshot(
      `"📋 Current Todo List: (empty) | Updated: 2025-01-15T10:30:00.000Z"`,
    );
  });

  it('should format todo list with only pending items', () => {
    const todos = [
      { text: 'Task A', completed: false },
      { text: 'Task B', completed: false },
      { text: 'Task C', completed: false },
    ];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (3 pending, 0 completed):
      - [ ] Task A
      - [ ] Task B
      - [ ] Task C"
    `);
  });

  it('should format todo list with only completed items', () => {
    const todos = [
      { text: 'Done task 1', completed: true },
      { text: 'Done task 2', completed: true },
    ];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (0 pending, 2 completed):
      - [x] Done task 1
      - [x] Done task 2"
    `);
  });

  it('should format todo list with mixed items', () => {
    const todos = [
      { text: 'Pending task', completed: false },
      { text: 'Completed task', completed: true },
      { text: 'Another pending', completed: false },
    ];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (2 pending, 1 completed):
      - [ ] Pending task
      - [x] Completed task
      - [ ] Another pending"
    `);
  });

  it('should format todo list with timestamp', () => {
    const todos = [
      { text: 'Task 1', completed: false },
      { text: 'Task 2', completed: true },
    ];
    expect(formatTodoStateSummary(todos, '2025-01-15T10:30:00.000Z')).toMatchInlineSnapshot(`
      "📋 Current Todo List (1 pending, 1 completed) | Updated: 2025-01-15T10:30:00.000Z:
      - [ ] Task 1
      - [x] Task 2"
    `);
  });

  it('should handle single item', () => {
    const todos = [{ text: 'Only task', completed: false }];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (1 pending, 0 completed):
      - [ ] Only task"
    `);
  });
});
