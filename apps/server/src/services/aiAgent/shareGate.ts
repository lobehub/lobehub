import type { AgentShareConfig } from '@/database/schemas';

/**
 * Server-side gate for shared-agent visitor conversations (agent share C4).
 *
 * Built exclusively by the shareChat router after the share access check —
 * never from client input. The gate is applied at operation-build time inside
 * `AiAgentService.execAgentWithReservation`, so the restricted tool/memory/file
 * surface is snapshotted into the operation state and every later step
 * inherits it without the context engine knowing about shares.
 */
export interface AgentShareGate {
  agentId: string;
  shareConfig: AgentShareConfig;
  /**
   * The signed-in visitor driving this run. Recorded on `topics.senderId` and
   * spend-log metadata; the run itself executes as the creator.
   */
  visitorUserId: string;
}

/**
 * Intersect a run's candidate plugin/skill ids with the share whitelist.
 * The whitelist defaults to empty, so an unconfigured share exposes no tools.
 */
export const filterPluginsByShareGate = (pluginIds: string[], gate: AgentShareGate): string[] => {
  const allowed = new Set(gate.shareConfig.enabledToolIds ?? []);

  return pluginIds.filter((id) => allowed.has(id));
};

/**
 * Strip agent files / knowledge bases the share config does not expose to
 * visitors. Mutates the resolved config in place — `agentConfig` is threaded
 * through the whole orchestration by reference (tool discovery, knowledge
 * flags, context builder snapshot), so a filtered copy would silently diverge.
 */
export const applyShareGateToAgentConfig = (
  agentConfig: { files?: unknown[] | null; knowledgeBases?: unknown[] | null },
  gate: AgentShareGate,
): void => {
  const filePermission = gate.shareConfig.filePermissionConfig;

  if (filePermission?.agentFiles !== 'read') agentConfig.files = [];
  if (filePermission?.knowledgeBase !== 'read') agentConfig.knowledgeBases = [];
};
