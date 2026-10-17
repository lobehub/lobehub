import type { GroupOrchestrationSupervisorSnapshot } from '@lobechat/agent-runtime';
import type { ConversationContext } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

/**
 * Context passed to `createGroupOrchestrationExecutors`.
 *
 * Extracted from `createGroupOrchestrationExecutors.ts` (source-layout §3:
 * that file was already over the 800-line limit and must not grow).
 */
export interface GroupOrchestrationExecutorsContext {
  get: () => ChatStore;
  /**
   * Message context for fetching messages
   * Contains agentId (groupId for group chat), topicId, scope, etc.
   */
  messageContext: ConversationContext;
  orchestrationOperationId: string;
  /**
   * Capture the supervisor state machine's counters. The member-run park exit
   * snapshots them into the completion-bridge registration so the bridge's
   * re-entry can restore the machine to its pre-park decision point instead
   * of resetting to a fresh supervisor (which would replay consumed decisions
   * and restart the round budget).
   */
  snapshotSupervisor?: () => GroupOrchestrationSupervisorSnapshot | undefined;
  supervisorAgentId: string;
}
