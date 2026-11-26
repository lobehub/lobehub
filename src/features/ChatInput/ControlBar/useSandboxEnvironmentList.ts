import type { EnvironmentConfiguration } from '@lobechat/types';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

import { pickableEnvironments } from './sandboxEnvironmentOptions';

/** An environment a project conversation can start from. */
export interface SandboxRepositoryOption {
  configuration?: Pick<EnvironmentConfiguration, 'sources'> | null;
  description?: string | null;
  id: string;
  name: string;
  /** `public` once published to the workspace; anything else is its owner's alone. */
  visibility?: string | null;
}

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
