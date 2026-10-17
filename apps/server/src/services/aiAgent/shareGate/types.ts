import type { LobeToolManifest, ToolExecutor, ToolSource } from '@lobechat/context-engine';
import type { AgentShareToolGrant } from '@lobechat/types';

import type { AgentShareConfig } from '@/database/schemas';

/**
 * Server-side gate for shared-agent visitor conversations.
 *
 * Built exclusively by the shareChat router after the share access check —
 * never from client input. The gate is applied at operation-build time inside
 * `AiAgentService.execAgent`, so the restricted tool/memory/file surface is
 * snapshotted into the operation state and every later step inherits it
 * without the context engine knowing about shares.
 */
export interface AgentShareGate {
  agentId: string;
  shareConfig: AgentShareConfig;
  /**
   * The `agentShares.id` this run was authorized against — read together with
   * `shareConfig` in the SAME `AgentShareModel.findByShareIdWithAccessCheck`
   * call.
   *
   * "The share row for this agent still exists AND its id still equals
   * `shareId` AND its visibility is still `link`" is exactly the condition
   * "this run's authorization has not been revoked". Every re-validation in
   * the visitor chain (`shareVisitorAbuseGuards`, the per-step runtime
   * re-check) is that one comparison.
   *
   * The visibility half carries the ordinary case: turning sharing off flips
   * the row to `private` and keeps it, so the owner can resume the same link
   * later (`AgentShareModel.updateVisibility`). The id half covers a row that
   * genuinely went away and came back as a different instance — a hard delete
   * (`AgentShareModel.deleteByAgentId`) or an agent delete + recreate.
   */
  shareId: string;
  /**
   * The signed-in visitor driving this run. Recorded on `topics.senderId` and
   * spend-log metadata; the run itself executes as the creator.
   */
  visitorUserId: string;
}

/**
 * Minimal shape a `DataToolAccessRule.grant` needs — either the full share
 * gate's `shareConfig`, or the trimmed `agentShare` marker threaded through
 * `RuntimeExecutorContext` / `ToolExecutionContext` for tool calls resolved
 * outside this module (see {@link isShareBlockedDataToolCall}).
 */
export interface ShareDataToolPermissions {
  allowReadMemory?: boolean;
  /**
   * Agent's own persisted, `enabled` knowledge-base ids (never
   * visitor-supplied). Currently always empty for a share run — see
   * {@link applyShareGateToAgentConfig} — but kept so the id-scoping rule
   * below stays wired should a knowledge-base grant return.
   */
  knowledgeBaseIds?: string[];
  /**
   * The share's `skillGrants`. Read here only to answer "does this share
   * authorize any skill at all", which is what turns the `lobe-skills` TOOL on;
   * which individual skills it may load is decided by
   * {@link filterSkillsByShareGate} at assembly and re-checked at load time in
   * the skill runtime.
   */
  skillGrants?: string[];
  toolGrants?: AgentShareToolGrant[];
}

/**
 * The assembled operation-level tool set, right before it is handed to
 * `AgentRuntimeService.createOperation` as `toolSet`.
 */
export interface ShareGateToolSet {
  activatableToolIds: string[];
  enabledToolIds: string[];
  executorMap: Record<string, ToolExecutor>;
  manifestMap: Record<string, LobeToolManifest>;
  sourceMap: Record<string, ToolSource>;
  tools: any[] | undefined;
}
