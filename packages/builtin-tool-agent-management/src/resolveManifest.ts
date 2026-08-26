import type { BuiltinManifestResolver } from '@lobechat/types';

import { AgentManagementManifest } from './manifest';
import { AgentManagementApiName } from './types';

/**
 * Context-aware manifest for the `lobe-agent-management` tool.
 *
 * Sub-agent dispatch (`callAgent`) is not available for shared visitor runs.
 * The rest of the tool (createAgent/updateAgent/searchAgent/etc.) stays
 * available — only the dispatch API is hidden, so this returns a trimmed
 * manifest rather than `null`.
 */
export const resolveAgentManagementManifest: BuiltinManifestResolver = (context) => {
  if (!context.isShareVisitor) return AgentManagementManifest;

  return {
    ...AgentManagementManifest,
    api: AgentManagementManifest.api.filter((api) => api.name !== AgentManagementApiName.callAgent),
  };
};
