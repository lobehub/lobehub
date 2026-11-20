import { isHeterogeneousAgentModelId } from '@lobechat/const';
import { ChatErrorType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';

import {
  acquireAgentRunSlot,
  rebindAgentRunSlot,
  releaseAgentRunSlot,
} from '@/business/server/agent-run/runConcurrency';
import type { AgentConfigWithId } from '@/server/services/agent';
import { isForegroundOperationTrigger } from '@/server/services/agentRuntime/foregroundOperation';

import type { InternalExecAgentParams } from '../types';

/**
 * How a run counts toward its user's concurrent-run cap.
 *
 * - `exempt`: takes no slot. A sub-agent or group member rides its root's
 *   slot; Workspace, shared-visitor and background runs are capped elsewhere
 *   or must not fail; an external agent (Claude Code, Codex, …) runs on a
 *   device that never renews a lease.
 * - `counted`: takes a slot without being refused — it continues a run the
 *   user already started (an approval or tool-result resume, a queued
 *   follow-up, a regeneration), or no composer is there to tell.
 * - `enforced`: a fresh composer send, refused once the cap is reached.
 */
export type RunSlotPolicy = 'counted' | 'enforced' | 'exempt';

export const resolveRunSlotPolicy = (
  params: InternalExecAgentParams,
  { agentConfig, workspaceId }: { agentConfig: AgentConfigWithId; workspaceId?: string },
): RunSlotPolicy => {
  const { appContext } = params;
  if (workspaceId || params.shareGate) return 'exempt';
  if (
    params.parentOperationId ||
    appContext?.isSubAgent ||
    appContext?.orchestrationRole === 'member'
  )
    return 'exempt';
  if (!isForegroundOperationTrigger(params.trigger)) return 'exempt';
  if (
    agentConfig.agencyConfig?.heterogeneousProvider?.type ||
    isHeterogeneousAgentModelId(agentConfig.model)
  )
    return 'exempt';

  const continuesRun =
    !!params.resume ||
    !!params.resumeApproval ||
    !!params.resumeApprovals?.length ||
    !!params.resumeToolResult ||
    !!params.parentMessageId ||
    !!params.approvalResolutionRequestId ||
    !!params.steer;
  return params.interactiveStart && !continuesRun ? 'enforced' : 'counted';
};

/**
 * The slot one `execAgentTurn` call holds. It is taken before the turn writes
 * any row, under a provisional id because the operation id is minted later,
 * and moved to that id once it exists. Until the operation starts, the caller
 * releases it on every exit; afterwards the run's completion releases it.
 */
export interface RunSlotClaim {
  /** Set once the started operation owns the slot. */
  handedOff?: boolean;
  holderId?: string;
}

/**
 * Takes the run's slot, or throws `TOO_MANY_REQUESTS` before the turn writes
 * anything, so the refused message stays in the composer.
 */
export const claimRunSlot = async (
  claim: RunSlotClaim,
  { policy, userId }: { policy: RunSlotPolicy; userId: string },
): Promise<void> => {
  if (policy === 'exempt') return;

  const holderId = `pending_${nanoid()}`;
  const result = await acquireAgentRunSlot({
    enforce: policy === 'enforced',
    holderId,
    userId,
  });
  if (!result.acquired) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: ChatErrorType.AgentConcurrencyLimitExceeded,
    });
  }
  claim.holderId = holderId;
};

/** Moves the claimed slot to the operation that will hold it for the rest of the run. */
export const bindRunSlot = async (claim: RunSlotClaim, userId: string, operationId: string) => {
  if (!claim.holderId || claim.holderId === operationId) return;
  await rebindAgentRunSlot(userId, claim.holderId, operationId);
  claim.holderId = operationId;
};

/** Frees a slot whose operation never started. */
export const releaseUnstartedRunSlot = async (claim: RunSlotClaim, userId: string) => {
  if (!claim.holderId || claim.handedOff) return;
  await releaseAgentRunSlot(userId, claim.holderId);
};
