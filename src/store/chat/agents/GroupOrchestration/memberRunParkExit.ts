import type {
  AgentState,
  GroupOrchestrationEvent,
  GroupOrchestrationSupervisorSnapshot,
} from '@lobechat/agent-runtime';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { debug } from 'debug';

import { registerGroupBridgeFromParkExit } from '@/store/chat/agents/transports/clientSubAgentBridge';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const log = debug('lobe-store:group-orchestration-executors');

interface MemberRunParkExitParams {
  agentId: string;
  get: () => any;
  messageContext: ConversationContext;
  orchestrationOperationId: string;
  sessionLogId: string;
  snapshotSupervisor?: () => GroupOrchestrationSupervisorSnapshot | undefined;
  state: AgentState;
  subContext: ConversationContext;
  supervisorAgentId: string;
  taskOperationId: string;
  toolMessageId: string;
}

/**
 * Bounded retry for the park-exit's optimistic writes. A transient network
 * failure inside these writes must NOT escape `handleMemberRunParkExit`:
 * the enclosing catch (createGroupOrchestrationExecutors, client async task
 * executor) converts any rejection into a terminal
 * `task_completed { success: false }` — but `runtimeResult.parked` already
 * established that the member is still active, so a thrown park-exit lets
 * the supervisor continue/finish while the member later completes
 * independently (a false terminal result). Contain + retry instead: after
 * the burst the loop still returns the nonterminal `result: undefined` —
 * the bridge arming, the park marker, and the backfill text are
 * best-effort, and the bridge still settles the member on its own terminal
 * boundary.
 */
const retryOptimisticWrite = async (write: () => Promise<unknown>): Promise<void> => {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await write();
      return;
    } catch (error) {
      log('park-exit optimistic write failed (attempt %d/4): %O', attempt, error);
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
};

/**
 * Member-run park exit: the run parked (human approval / async tool), so the
 * orchestration loop must END this round without a terminal decision and let
 * the client completion bridge re-enter it when the member settles.
 *
 * Extracted from createGroupOrchestrationExecutors (source-layout §3: the
 * executor file was over the 800-line limit and must not grow).
 */
export const handleMemberRunParkExit = async ({
  agentId,
  get,
  messageContext,
  orchestrationOperationId,
  sessionLogId,
  snapshotSupervisor,
  state,
  subContext,
  taskOperationId,
  supervisorAgentId,
  toolMessageId,
}: MemberRunParkExitParams): Promise<{
  events: GroupOrchestrationEvent[];
  newState: AgentState;
  result: undefined;
}> => {
  log(`[${sessionLogId}] Member run parked (human approval / async tool), not completed`);

  // Register the client completion bridge: when the member's run
  // eventually reaches a terminal state, the bridge backfills THIS
  // tool message with the member's final answer and re-enters the
  // orchestration loop with a `task_completed` result — the supervisor
  // then drives the next round. The old park-exit (`result: undefined`)
  // left the orchestration parked forever: nothing re-entered the
  // loop, so the supervisor never saw the member's result.
  registerGroupBridgeFromParkExit({
    childContext: subContext,
    childOperationId: taskOperationId,
    memberAgentId: agentId,
    messageContext,
    orchestrationOperationId,
    supervisorAgentId,
    // Supervisor state machine at the park point: the bridge's
    // re-entry restores it so the resumed loop continues from the
    // original decision point (round counter / skip flag preserved).
    supervisorSnapshot: snapshotSupervisor?.(),
    toolMessageId,
  });

  await retryOptimisticWrite(() =>
    get().optimisticUpdateMessageContent(
      toolMessageId,
      'Member agent is still running: it paused for human approval or an async tool and has not finished yet.',
      undefined,
      { operationId: state.operationId },
    ),
  );

  // P1 (round-11): persist a durable park marker on the group tool
  // row. The executor-created state carries no `status`, so after a
  // reload the bridge's `isDeferredPlaceholderStillRunning` fallback
  // (the orchestration operation is gone) always saw a non-`running`
  // row and skipped the supervisor re-entry — the child settled but
  // the orchestration stayed parked. Mirror the sub-agent deferred
  // placeholder shape (`{ status: 'running', threadId }`), merging
  // over the current state: the bridge reads this same row to gate
  // the re-entry and overwrites it with terminal status on settle.
  await retryOptimisticWrite(() =>
    get().optimisticUpdatePluginState(toolMessageId, {
      ...(get().dbMessagesMap[messageMapKey(messageContext)] || []).find(
        (m: UIChatMessage) => m.id === toolMessageId,
      )?.pluginState,
      status: 'running',
      threadId: subContext.threadId,
    }),
  );

  return {
    events: [] as GroupOrchestrationEvent[],
    newState: state,
    // End the loop without a terminal decision: `undefined` stops the
    // orchestration `while` and the non-done status keeps the
    // orchestration operation alive instead of completing it. The
    // completion bridge re-enters the loop when the member settles.
    result: undefined,
  };
};
