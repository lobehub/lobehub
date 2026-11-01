import type { TodoSummary } from '@lobechat/shared-tool-ui/components';

import type { TodoItem, TodoList } from '../../types';

/**
 * Normalize pluginState todos into a TodoItem array.
 * Handles both the new format ({ items: TodoItem[] }) and the
 * legacy format where todos was stored as a bare TodoItem[].
 */
export const normalizeTodoItems = (todos?: TodoList | TodoItem[]): TodoItem[] => {
  if (!todos) return [];
  if (Array.isArray(todos)) return todos;
  return todos.items || [];
};

/**
 * Compute the summary shown in the todo inspector / panel header,
 * matching the Claude Code todo rendering states.
 */
export const computeTodoSummary = (items: TodoItem[]): TodoSummary => {
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;
  const processing = items.find((item) => item.status === 'processing');

  if (processing) return { completed, detail: processing.text, state: 'inProgress', total };
  if (total > 0 && completed === total) return { completed, state: 'allDone', total };

  const lastCompleted = [...items].reverse().find((item) => item.status === 'completed');
  if (lastCompleted)
    return { completed, detail: lastCompleted.text, state: 'completedStep', total };

  return { completed, state: 'idle', total };
};

export const TODO_SUMMARY_LABEL_KEYS = {
  allDone: 'builtins.lobe-agent.todos.allDone',
  completedStep: 'builtins.lobe-agent.todos.completedStep',
  idle: 'builtins.lobe-agent.todos.todos',
  inProgress: 'builtins.lobe-agent.todos.currentStep',
} as const;
