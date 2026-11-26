import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicMetadata } from '@lobechat/types';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { ProjectEnvironmentRepository } from '@/database/repositories/projectEnvironment';

const log = debug('lobe-server:sandbox:project-placement');

export type ProjectTopicSandbox = Pick<ChatTopicMetadata, 'sandboxEnvironmentId'>;

export interface ProjectTopicSandboxInput {
  /** The agent the conversation runs; a workspace-public one applies published environments only. */
  agentId?: string;
  db: LobeChatDatabase;
  /** Ignored: a project has one environment. Kept for older clients. */
  environmentId?: string;
  projectId: string;
  userId: string;
  workspaceId?: string;
}

const hasGitSource = (configuration: { sources?: { kind?: string }[] } | null | undefined) =>
  (configuration?.sources ?? []).some((source) => source.kind === 'git');

/**
 * The sandbox a new project conversation starts in: the project's environment —
 * its repositories, setup and variables — applied to a temporary Cloud Sandbox.
 *
 * Coding belongs in the temporary sandbox, which is discarded after use: a
 * repository's dependencies and build output would only fill the drive, and
 * the remote repository is where the code is kept. So the conversation names
 * the repository and no folder — each conversation clones it afresh — and
 * a person who wants the drive picks it in the composer.
 *
 * A workspace-public agent runs on its caller's session and applies published
 * environments only (see `resolveInitialization`), so for one a private
 * repository is never picked: it would be shown as the conversation's
 * repository and then never cloned.
 *
 * Never throws; a project with no repository starts where any conversation
 * does.
 */
export const resolveProjectTopicSandbox = async ({
  agentId,
  db,
  projectId,
  userId,
  workspaceId,
}: ProjectTopicSandboxInput): Promise<ProjectTopicSandbox> => {
  try {
    const environment = await new ProjectEnvironmentRepository(db, userId, workspaceId).get(
      projectId,
    );
    if (!hasGitSource(environment.configuration)) return {};

    const sharedAgent =
      !!workspaceId &&
      !!agentId &&
      (await new AgentModel(db, userId, workspaceId).getAgentVisibility(agentId)) === 'public';
    if (sharedAgent && environment.visibility !== 'public') return {};

    return { sandboxEnvironmentId: environment.id };
  } catch (error) {
    log('Failed to resolve the sandbox for a topic in project %s: %O', projectId, error);
    return {};
  }
};
