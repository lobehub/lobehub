import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';

import type { AgentShareGate } from '../shareGate';

export interface TurnProjectDeps {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

export interface TurnProjectInput {
  /** Project of the working directory a new topic is born in. */
  directoryProjectId?: string;
  /** `appContext.projectId`; only honoured when the turn creates its topic. */
  requestedProjectId?: string;
  shareGate?: AgentShareGate;
  taskId?: string;
  /** `undefined` while the topic does not exist yet; `null` for an unbound topic. */
  topicProjectId?: string | null;
}

/**
 * The project a turn runs in, in order of authority: the directory or topic
 * binding, the project the request opened (new topics only — an existing topic
 * is never re-homed by a request), and the task the run executes. The agent
 * alone never implies a project: a main agent (LobeAI by default) is reusable
 * and may coordinate several projects. Share visitors never run inside the
 * creator's projects.
 */
export const resolveTurnProjectId = async (
  deps: TurnProjectDeps,
  input: TurnProjectInput,
): Promise<string | undefined> => {
  if (input.directoryProjectId) return input.directoryProjectId;
  if (input.topicProjectId) return input.topicProjectId;
  if (input.shareGate) return;

  if (input.topicProjectId === undefined && input.requestedProjectId) {
    const project = await new ProjectModel(deps.db, deps.userId, deps.workspaceId).findById(
      input.requestedProjectId,
    );
    if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    return project.id;
  }

  if (!input.taskId) return;
  // `resolve`, like the operation's own task lookup, so both read the task the same way.
  const task = await new TaskModel(deps.db, deps.userId, deps.workspaceId).resolve(input.taskId);
  return task?.projectId ?? undefined;
};
