import type { BuiltinManifestResolver } from '@lobechat/types';

import { AgentManagementManifest } from './manifest';
import { AgentManagementApiName } from './types';

/**
 * Context-aware manifest for the `lobe-agent-management` tool.
 *
 * `callAgent` dispatches to `ctx.subAgent.run` (see
 * `apps/server/src/services/toolExecution/serverRuntimes/agentManagement.ts`),
 * the SAME runner `lobe-agent.callSubAgent` uses. That child run has no
 * shareGate of its own (agent share C3) — it would execute with the CREATOR's
 * full, unrestricted tool/file/memory surface, one hop around the share
 * whitelist. `resolveLobeAgentManifest` already hides `callSubAgent` for a
 * share visitor; this mirrors that for `callAgent` so a share whitelist that
 * explicitly includes `lobe-agent-management` can't route the model to it.
 *
 * The rest of the tool (createAgent/updateAgent/searchAgent/etc.) stays
 * available — only the dispatch API is hidden, so this returns a trimmed
 * manifest rather than `null`.
 *
 * This is a belt-and-suspenders layer: `ServerToolTransport` also fails
 * closed by withholding `ctx.subAgent` from the executor for a share-visitor
 * run, so even a stale/replayed `callAgent` tool call cannot reach a real
 * dispatch.
 */
export const resolveAgentManagementManifest: BuiltinManifestResolver = (context) => {
  if (!context.isShareVisitor) return AgentManagementManifest;

  return {
    ...AgentManagementManifest,
    api: AgentManagementManifest.api.filter((api) => api.name !== AgentManagementApiName.callAgent),
  };
};
