export type TodoStatus = 'todo' | 'processing' | 'completed';

export interface TodoItem {
  status: TodoStatus;
  text: string;
}

/**
 * Format a unified todo state summary for tool response content
 *
 * @param todos - The current todo items
 * @param updatedAt - Optional timestamp when the list was last updated
 * @returns Formatted string showing current todo list state
 */
export const formatTodoStateSummary = (todos: TodoItem[], updatedAt?: string): string => {
  const timeInfo = updatedAt ? ` | Updated: ${updatedAt}` : '';

  if (todos.length === 0) {
    return `📋 Current Todo List: (empty)${timeInfo}`;
  }

  const completed = todos.filter((t) => t.status === 'completed').length;
  const processing = todos.filter((t) => t.status === 'processing').length;
  const pending = todos.length - completed - processing;

  const lines = todos.map((item) => {
    const checkbox =
      item.status === 'completed' ? '- [x]' : item.status === 'processing' ? '- [~]' : '- [ ]';
    return `${checkbox} ${item.text}`;
  });

  return `📋 Current Todo List (${pending} todo, ${processing} processing, ${completed} completed)${timeInfo}:\n${lines.join('\n')}`;
};
