import { withConversationGoalPrompt } from '@lobechat/builtin-tool-goal';
import { buildTaskDetailPrompt, buildTaskListPrompt } from '@lobechat/prompts';
import type { ConversationContext } from '@lobechat/types';

import { getTaskStoreState } from '@/store/task';

/**
 * Task Manager context for the task list or task detail page the Tasks side
 * conversation is opened on, built from the task store the page renders.
 * Returns undefined outside Tasks or before the viewed task has loaded.
 */
export const buildViewedTaskPrompt = (
  context: Pick<ConversationContext, 'defaultTaskAssigneeAgentId' | 'viewedTask'> | undefined,
): string | undefined => {
  const viewedTask = context?.viewedTask;
  if (!viewedTask) return;

  const taskState = getTaskStoreState();
  const defaultAssigneeAgentId = context.defaultTaskAssigneeAgentId;

  if (viewedTask.type === 'list') {
    const viewedList = taskState.activeTaskListKey
      ? taskState.taskListMap[taskState.activeTaskListKey]
      : undefined;
    const tasks = viewedList?.items ?? [];
    return buildTaskListPrompt({
      defaultAssigneeAgentId,
      tasks,
      total: viewedList?.total || tasks.length,
    });
  }

  const task = taskState.taskDetailMap[viewedTask.taskId];
  if (task) return buildTaskDetailPrompt({ defaultAssigneeAgentId, task });
};

/**
 * Static instructions for a local hetero agent: its own system context, the
 * `/goal` instructions (it plans through `lh` in the same run, not a tool) and
 * the Tasks page it was asked from.
 */
export const withHeteroContext = (
  agentSystemContext: string | undefined,
  message: string,
  context: Pick<ConversationContext, 'defaultTaskAssigneeAgentId' | 'viewedTask'>,
): string | undefined => {
  const viewedTaskPrompt = buildViewedTaskPrompt(context);
  const systemContext = viewedTaskPrompt
    ? [agentSystemContext?.trim(), viewedTaskPrompt].filter(Boolean).join('\n\n')
    : agentSystemContext;

  return withConversationGoalPrompt(systemContext, message);
};
