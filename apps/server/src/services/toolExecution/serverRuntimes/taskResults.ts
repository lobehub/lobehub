import { taskResultState } from '@lobechat/builtin-tool-task';

export const taskResult = (
  task: { id: string; identifier: string },
  content: string,
  extra: Record<string, unknown> = {},
) => ({
  content,
  state: taskResultState(task, extra),
  success: true,
});

export const taskResultLabel = (task: { id: string; identifier: string }) =>
  `${task.identifier} (id: ${task.id})`;
