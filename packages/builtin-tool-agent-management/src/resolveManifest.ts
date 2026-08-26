import type { BuiltinManifestResolver } from '@lobechat/types';

import { AgentManagementManifest } from './manifest';

/**
 * Context-aware manifest for the `lobe-agent-management` tool.
 *
 * A share-visitor run must not be offered ANY API from this tool, not just
 * the sub-agent dispatch one (`callAgent`). Every API here operates against
 * the CREATOR's private agent collection with a visitor-suppliable `agentId`
 * argument that is never checked against the shared agent itself:
 * `searchAgent` (source: 'user') enumerates the creator's whole workspace,
 * `getAgentDetail` returns any creator-owned agent's full config (including
 * its system prompt) for an arbitrary id, and `createAgent` / `updateAgent` /
 * `updatePrompt` / `duplicateAgent` / `installPlugin` persistently mutate the
 * creator's agent collection — all under the creator's own `userId` (the run
 * executes as the creator; see `agentManagementRuntime` in
 * `apps/server/src/services/toolExecution/serverRuntimes/agentManagement.ts`,
 * which scopes every model by `userId` but takes `agentId` straight from the
 * model's arguments). None of these APIs has an honest per-API scoping to
 * this specific shared agent, so — unlike `lobe-agent` (see
 * `resolveLobeAgentManifest`), which keeps its non-dispatch APIs because they
 * ARE self-scoped to the current agent — the whole tool is hidden here
 * (`null`) rather than trimmed API-by-API. Mirrored, as defense in depth, by
 * the unconditional full-identifier strip in
 * `apps/server/src/services/aiAgent/shareGate.ts`'s
 * `applyShareGateToToolSet`, and by dispatch-time blocking in
 * `isShareBlockedDataToolCall` — this resolver only changes what the model is
 * OFFERED, not what a dispatcher would execute if the model called it anyway.
 */
export const resolveAgentManagementManifest: BuiltinManifestResolver = (context) => {
  if (context.isShareVisitor) return null;

  return AgentManagementManifest;
};
