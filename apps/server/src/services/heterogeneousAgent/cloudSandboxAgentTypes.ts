import { isLocalHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { LocalHeterogeneousAgentType } from '@lobechat/types';

import { sandboxEnv } from '@/envs/sandbox';

/**
 * The coding-agent CLIs the official sandbox runtime image carries.
 */
const DEFAULT_CLOUD_SANDBOX_AGENT_TYPES: LocalHeterogeneousAgentType[] = ['claude-code', 'codex'];

/**
 * The coding-agent CLIs this deployment allows in the cloud sandbox.
 *
 * What limits it is the runtime image, not the dispatch path: `spawnHeteroSandbox`
 * launches every type identically, through `lh hetero exec`, which already accepts
 * all of them. So a type can run there exactly when its binary is present in the
 * image — a property of the deployment, not of this repository. The default names
 * what the official image ships; a deployment that builds its own image widens
 * the set with `HETERO_SANDBOX_AGENT_TYPES`.
 *
 * Names that are not agent type ids are dropped rather than returned, because
 * this list is also published to the client, which renders it.
 */
export const resolveCloudSandboxAgentTypes = (): LocalHeterogeneousAgentType[] => {
  const configured = sandboxEnv.HETERO_SANDBOX_AGENT_TYPES?.split(',')
    .map((name) => name.trim())
    .filter((name): name is LocalHeterogeneousAgentType => isLocalHeterogeneousType(name));

  return configured?.length ? configured : DEFAULT_CLOUD_SANDBOX_AGENT_TYPES;
};
