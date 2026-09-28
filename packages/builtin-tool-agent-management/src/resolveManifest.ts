import type { BuiltinManifestResolver } from '@lobechat/types';

import { AgentManagementManifest } from './manifest';
import { systemPromptWithoutCallAgent } from './systemRole';
import { AgentManagementApiName } from './types';

/**
 * Context-aware manifest for the agent-management tool.
 *
 * `callAgent` must be hidden inside a sub-agent run: the server executor
 * rejects nested dispatch outright (NESTED_AGENT_CALL_NOT_ALLOWED), so
 * advertising the API there only makes the model burn tool calls on a path
 * that can never succeed. Agent CRUD / search / plugin APIs stay available —
 * this returns a trimmed manifest (not `null`). It rewrites BOTH halves of the
 * manifest in step: the `api` list drops `callAgent`, and `systemRole`
 * switches to the variant without the dispatch guidance plus an explicit note
 * that delegation is unavailable — otherwise the prompt would keep instructing
 * the model to dispatch a tool that is no longer in its tool list.
 */
export const resolveAgentManagementManifest: BuiltinManifestResolver = (context) => {
  if (context.isSubAgent !== true) return AgentManagementManifest;

  return {
    ...AgentManagementManifest,
    api: AgentManagementManifest.api.filter((api) => api.name !== AgentManagementApiName.callAgent),
    systemRole: systemPromptWithoutCallAgent,
  };
};
