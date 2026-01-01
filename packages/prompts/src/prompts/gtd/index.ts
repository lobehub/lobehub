export interface TodoItem {
  completed: boolean;
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

  const completed = todos.filter((t) => t.completed).length;
  const pending = todos.length - completed;

  const lines = todos.map((item) => {
    const checkbox = item.completed ? '- [x]' : '- [ ]';
    return `${checkbox} ${item.text}`;
  });

  return `📋 Current Todo List (${pending} pending, ${completed} completed)${timeInfo}:\n${lines.join('\n')}`;
};
