import { projectCheckoutDirectory, type SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicMetadata } from '@lobechat/types';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { EnvironmentModel } from '@/database/models/environment';
import { ProjectModel } from '@/database/models/project';

const log = debug('lobe-server:sandbox:project-placement');

export type ProjectTopicSandbox = Pick<
  ChatTopicMetadata,
  'sandboxDrive' | 'sandboxEnvironmentId' | 'sandboxWorkingDirectory'
>;

export interface ProjectTopicSandboxInput {
  /** The agent the conversation runs; a workspace-public one applies published environments only. */
  agentId?: string;
  db: LobeChatDatabase;
  /** A repository the composer picked; must be one linked to the project. */
  environmentId?: string;
  projectId: string;
  userId: string;
  workspaceId?: string;
}

const hasGitSource = (configuration: { sources?: { kind?: string }[] } | null | undefined) =>
  (configuration?.sources ?? []).some((source) => source.kind === 'git');

/**
 * The sandbox a new project conversation starts in: the project's repository,
 * checked out in the project's own folder on the drive.
 *
 * The folder is what makes it persistent. The sandbox initializes an empty
 * folder from the environment and leaves a filled one alone, so the first
 * conversation clones and every later one picks up the same checkout. Nothing
 * is created here — the run creates the folder when it first needs it (see
 * `resolvePlacement`), so starting a conversation never waits on a sandbox.
 * Without a storage entitlement the run goes to a temporary sandbox, where the
 * repository still applies.
 *
 * A private repository goes on the member's personal drive: the public drive
 * is every member's, and the checkout can hold its owner's credentials.
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
  environmentId,
  projectId,
  userId,
  workspaceId,
}: ProjectTopicSandboxInput): Promise<ProjectTopicSandbox> => {
  try {
    const linked = await new ProjectModel(db, userId, workspaceId).listEnvironments(projectId);
    const sharedAgent =
      !!workspaceId &&
      !!agentId &&
      (await new AgentModel(db, userId, workspaceId).getAgentVisibility(agentId)) === 'public';
    const usable = linked.filter(
      (item) => hasGitSource(item.configuration) && (!sharedAgent || item.visibility === 'public'),
    );
    const picked = environmentId ? usable.find((item) => item.id === environmentId) : usable[0];
    if (!picked) return {};

    const environment = await new EnvironmentModel(db, userId, workspaceId).findById(picked.id);
    if (!environment) return {};

    const drive: SandboxDrive = environment.visibility === 'public' ? 'public' : 'personal';

    return {
      ...(workspaceId && { sandboxDrive: drive }),
      sandboxEnvironmentId: environment.id,
      sandboxWorkingDirectory: projectCheckoutDirectory(projectId, environment.id),
    };
  } catch (error) {
    log('Failed to resolve the sandbox for a topic in project %s: %O', projectId, error);
    return {};
  }
};
