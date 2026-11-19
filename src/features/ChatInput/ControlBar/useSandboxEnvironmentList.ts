import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { environmentService } from '@/services/environment';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

import { pickableEnvironments } from './sandboxEnvironmentOptions';
import type { SandboxRepositoryOption } from './SandboxRepositoryMenu';

/**
 * Whether the conversation's agent is workspace-public. Such an agent runs on
 * its caller's session and applies published environments only. Read by the
 * conversation's own agent: in split or embedded views it need not be the
 * active one, and the server checks the topic's agent.
 */
export const useIsSharedAgent = (agentId: string) => {
  const workspaceId = useActiveWorkspaceId();
  return useAgentStore(
    (s) => !!workspaceId && agentSelectors.getAgentVisibilityById(agentId)(s) === 'public',
  );
};

export interface SandboxEnvironmentList {
  environments: SandboxRepositoryOption[];
  failed: boolean;
  loaded: boolean;
  refresh: () => Promise<unknown>;
}

/**
 * A project's environments a conversation may start from — every project has
 * exactly one. Fetched only while `enabled` and a project is given.
 */
export const useProjectSandboxEnvironments = (
  projectId: string | undefined,
  sharedAgent: boolean,
  enabled = true,
): SandboxEnvironmentList => {
  const sync = useProjectDirectoryStore((s) => s.useFetchEnvironments)(
    projectId,
    enabled && !!projectId,
  );
  const environments = useProjectEnvironments(projectId);

  return {
    environments: projectId ? pickableEnvironments(environments, sharedAgent) : [],
    failed: !!sync.error,
    loaded: sync.hasData,
    refresh: sync.revalidate,
  };
};

/**
 * The environments a conversation may start from. A project conversation runs
 * in its project's environment — the workspace's shared list leaves it out —
 * so it is offered that one alone. Any other conversation is offered the
 * workspace's shared environments. Only the list in use is fetched.
 */
export const useSandboxEnvironmentList = ({
  projectId,
  sharedAgent,
  workspaceId,
}: {
  projectId?: string;
  sharedAgent: boolean;
  workspaceId?: string | null;
}): SandboxEnvironmentList => {
  const shared = useSWR(projectId ? null : ['sandbox-environment-chip', workspaceId ?? ''], () =>
    environmentService.listEnvironments(),
  );
  const project = useProjectSandboxEnvironments(projectId, sharedAgent);

  if (projectId) return project;

  return {
    environments: pickableEnvironments(shared.data?.environments ?? [], sharedAgent),
    failed: !!shared.error,
    loaded: !!shared.data,
    refresh: () => shared.mutate(),
  };
};
