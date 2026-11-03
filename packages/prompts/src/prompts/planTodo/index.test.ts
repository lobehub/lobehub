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
      { text: 'Task A', status: 'todo' as const },
      { text: 'Task B', status: 'todo' as const },
      { text: 'Task C', status: 'todo' as const },
    ];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (3 todo, 0 processing, 0 completed):
      - [ ] Task A
      - [ ] Task B
      - [ ] Task C"
    `);
  });

  it('should format todo list with only completed items', () => {
    const todos = [
      { text: 'Done task 1', status: 'completed' as const },
      { text: 'Done task 2', status: 'completed' as const },
    ];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (0 todo, 0 processing, 2 completed):
      - [x] Done task 1
      - [x] Done task 2"
    `);
  });

  it('should format todo list with mixed items', () => {
    const todos = [
      { text: 'Pending task', status: 'todo' as const },
      { text: 'Completed task', status: 'completed' as const },
      { text: 'Another pending', status: 'todo' as const },
    ];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (2 todo, 0 processing, 1 completed):
      - [ ] Pending task
      - [x] Completed task
      - [ ] Another pending"
    `);
  });

  it('should format todo list with timestamp', () => {
    const todos = [
      { text: 'Task 1', status: 'todo' as const },
      { text: 'Task 2', status: 'completed' as const },
    ];
    expect(formatTodoStateSummary(todos, '2025-01-15T10:30:00.000Z')).toMatchInlineSnapshot(`
      "📋 Current Todo List (1 todo, 0 processing, 1 completed) | Updated: 2025-01-15T10:30:00.000Z:
      - [ ] Task 1
      - [x] Task 2"
    `);
  });

  it('should handle single item', () => {
    const todos = [{ text: 'Only task', status: 'todo' as const }];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (1 todo, 0 processing, 0 completed):
      - [ ] Only task"
    `);
  });

  it('should format todo list with processing items', () => {
    const todos = [
      { text: 'Todo task', status: 'todo' as const },
      { text: 'Processing task 1', status: 'processing' as const },
      { text: 'Processing task 2', status: 'processing' as const },
      { text: 'Done task', status: 'completed' as const },
    ];
    expect(formatTodoStateSummary(todos)).toMatchInlineSnapshot(`
      "📋 Current Todo List (1 todo, 2 processing, 1 completed):
      - [ ] Todo task
      - [~] Processing task 1
      - [~] Processing task 2
      - [x] Done task"
    `);
  });
});
