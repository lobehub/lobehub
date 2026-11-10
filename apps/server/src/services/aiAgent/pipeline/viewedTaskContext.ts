import type { LobeChatDatabase } from '@lobechat/database';
import { buildTaskDetailPrompt, buildTaskManagerDefaultsPrompt } from '@lobechat/prompts';
import debug from 'debug';

import { TaskModel } from '@/database/models/task';
import { TaskDetailService } from '@/server/services/task/detail';
import { resolveTaskOrThrow } from '@/server/services/task/utils';

import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface ViewedTaskContextDeps {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Task Manager context for a run started from the Tasks side conversation.
 *
 * Server-run counterpart of the client streaming executor's `viewedTask`
 * injection: the gateway forwards the viewed task as `taskId`, so a run on a
 * task detail page answers "this task" from the task itself. Without a task
 * (list view) or when it cannot be loaded, only the assignee defaults remain.
 */
export const buildViewedTaskContextPrompt = async (
  deps: ViewedTaskContextDeps,
  appContext: InternalExecAgentParams['appContext'],
  taskId: string | undefined,
): Promise<string | undefined> => {
  if (appContext?.scope !== 'task') return;

  const defaultAssigneeAgentId = appContext.defaultTaskAssigneeAgentId;

  if (taskId) {
    try {
      const viewedTask = await resolveTaskOrThrow(
        new TaskModel(deps.db, deps.userId, deps.workspaceId),
        taskId,
      );
      const task = await new TaskDetailService(
        deps.db,
        deps.userId,
        deps.workspaceId,
      ).getTaskDetail(viewedTask.id);
      if (task) return buildTaskDetailPrompt({ defaultAssigneeAgentId, task });
    } catch (error) {
      log('failed to load viewed task %s: %O', taskId, error);
    }
  }

  if (!defaultAssigneeAgentId) return;

  return buildTaskManagerDefaultsPrompt({ defaultAssigneeAgentId });
};

/** Appends the viewed-task prompt to a hetero agent's static system context. */
export const joinSystemContext = (...parts: (string | undefined)[]): string | undefined =>
  parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n') || undefined;
