import type { StepContextTodos } from '@lobechat/types';

import type { WorkspaceProgressState } from '../types';

export const normalizeTaskProgress = (todos?: StepContextTodos): WorkspaceProgressState => {
  const items = todos?.items ?? [];
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const currentTask =
    items.find((item) => item.status === 'processing') ||
    items.find((item) => item.status === 'todo');

  return {
    completionPercent: items.length === 0 ? 0 : Math.round((completedCount / items.length) * 100),
    currentTask: currentTask?.text,
    items: items.map((item, index) => ({
      id: `todo-${index}`,
      status: item.status,
      text: item.text,
    })),
    updatedAt: todos?.updatedAt,
  };
};
