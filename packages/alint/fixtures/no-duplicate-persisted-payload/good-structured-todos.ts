// Fixture: the todo list in state is what the todo panel reads; the content
// is a short text summary of the same few items.
import type { BuiltinToolResult, TodoItem } from './types';

const formatTodoSummary = (todos: TodoItem[]) =>
  todos.map((todo) => `- [${todo.done ? 'x' : ' '}] ${todo.title}`).join('\n');

export function updateTodos(todos: TodoItem[]): BuiltinToolResult {
  return {
    content: formatTodoSummary(todos),
    state: { todos },
    success: true,
  };
}
