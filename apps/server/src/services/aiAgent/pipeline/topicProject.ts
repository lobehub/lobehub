import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicMetadata } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { resolveProjectTopicSandbox } from '@/server/services/sandbox/projectPlacement';

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

/**
 * A new topic's metadata with the project's repository applied: a project
 * conversation started anywhere — the sidebar's new topic, a task run — works
 * in the project's checkout, as one started from the project home does.
 *
 * Left alone when there is no project, when the topic lives in a device
 * directory (it runs there, not in the cloud), or when the conversation already
 * picked where it keeps its files — a pick in the composer wins, the temporary
 * sandbox included. The plan's default placement is not a pick: the checkout
 * takes its place.
 */
export const withProjectSandbox = async (
  deps: TurnProjectDeps,
  input: {
    /** The agent the run is for; its visibility decides which repositories it may apply. */
    agentId?: string;
    hasDirectory: boolean;
    metadata: ChatTopicMetadata | undefined;
    projectId: string | undefined;
  },
): Promise<ChatTopicMetadata | undefined> => {
  const { agentId, hasDirectory, projectId } = input;
  // Creation-time markers, never stored. `sandboxTemporary`: the composer chose
  // a temporary sandbox on purpose, so nothing is applied over it.
  // `sandboxSeeded`: the placement is the plan's default nobody chose, so a
  // project's checkout takes its place.
  const { sandboxSeeded, sandboxTemporary, ...rest } = input.metadata ?? {};
  const metadata =
    sandboxSeeded === undefined && sandboxTemporary === undefined
      ? input.metadata
      : Object.keys(rest).length > 0
        ? rest
        : undefined;
  if (sandboxTemporary || !projectId || hasDirectory) return metadata;
  if (
    !sandboxSeeded &&
    (metadata?.sandboxEnvironmentId ||
      metadata?.sandboxInstanceId ||
      metadata?.sandboxWorkingDirectory)
  )
    return metadata;

  const sandbox = await resolveProjectTopicSandbox({ ...deps, agentId, projectId });
  if (Object.keys(sandbox).length === 0) return metadata;

  // The checkout replaces a default placement whole, drive included.
  const {
    sandboxDrive: _drive,
    sandboxEnvironmentId: _environment,
    sandboxInstanceId: _instance,
    sandboxWorkingDirectory: _folder,
    ...others
  } = metadata ?? {};

  return { ...others, ...sandbox };
};
