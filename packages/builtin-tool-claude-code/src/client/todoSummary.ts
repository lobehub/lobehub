import type { TodoSummary } from '@lobechat/shared-tool-ui/components';

import type { ClaudeCodeTodoItem, TodoWriteArgs } from '../types';

/**
 * Compute the summary shown in the TodoWrite inspector / panel header.
 */
export const computeTodoSummary = (args?: TodoWriteArgs): TodoSummary => {
  const items = (args?.todos ?? []).filter(Boolean) as ClaudeCodeTodoItem[];
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;
  const inProgress = items.find((item) => item.status === 'in_progress');

  if (inProgress)
    return {
      completed,
      detail: inProgress.activeForm || inProgress.content,
      state: 'inProgress',
      total,
    };
  if (total > 0 && completed === total) return { completed, state: 'allDone', total };

  const lastCompleted = [...items].reverse().find((item) => item.status === 'completed');
  if (lastCompleted)
    return { completed, detail: lastCompleted.content, state: 'completedStep', total };

  return { completed, state: 'idle', total };
};

export const TODO_SUMMARY_LABEL_KEYS = {
  allDone: 'builtins.lobe-claude-code.todoWrite.allDone',
  completedStep: 'builtins.lobe-claude-code.todoWrite.completedStep',
  idle: 'builtins.lobe-claude-code.todoWrite.todos',
  inProgress: 'builtins.lobe-claude-code.todoWrite.currentStep',
} as const;
