import { isHeterogeneousAgentModelId } from '@lobechat/const';
import { nanoid } from '@lobechat/utils';

import {
  holdAgentRunFee,
  rebindAgentRunFee,
  releaseAgentRunFee,
} from '@/business/server/agent-run/runFee';
import type { AgentConfigWithId } from '@/server/services/agent';

import type { InternalExecAgentParams } from '../types';

/**
 * Whether a run carries the per-run fee. One fee covers what the user started:
 * the run they sent, regenerated or queued, foreground or background.
 *
 * Exempt:
 * - a continuation of a run already started (approval or tool-result resume,
 *   steer), which belongs to the run that held the fee;
 * - a sub-agent or group member, which is a step of its root run;
 * - Workspace runs, which bill elsewhere;
 * - an external agent (Claude Code, Codex, …), which runs on the user's device.
 */
export const shouldHoldRunFee = (
  params: InternalExecAgentParams,
  { agentConfig, workspaceId }: { agentConfig: AgentConfigWithId; workspaceId?: string },
): boolean => {
  const { appContext } = params;
  if (workspaceId) return false;
  if (
    params.parentOperationId ||
    appContext?.isSubAgent ||
    appContext?.orchestrationRole === 'member'
  )
    return false;
  if (
    agentConfig.agencyConfig?.heterogeneousProvider?.type ||
    isHeterogeneousAgentModelId(agentConfig.model)
  )
    return false;

  const continuesRun =
    !!params.resume ||
    !!params.resumeApproval ||
    !!params.resumeApprovals?.length ||
    !!params.resumeToolResult ||
    !!params.approvalResolutionRequestId ||
    !!params.steer;
  return !continuesRun;
};

/**
 * The fee one `execAgentTurn` call holds. Like the run slot, it is held before
 * the turn writes any row under a provisional id, and moved to the operation id
 * once it exists. Until the operation starts, the caller gives it back on every
 * exit; afterwards the run's completion settles it.
 */
export interface RunFeeClaim {
  /** Set once the started operation owns the fee. */
  handedOff?: boolean;
  holderId?: string;
}

/** Holds the run's fee under a provisional id. */
export const claimRunFee = async (
  claim: RunFeeClaim,
  { hold, userId }: { hold: boolean; userId: string },
): Promise<void> => {
  if (!hold) return;

  const holderId = `pending_${nanoid()}`;
  await holdAgentRunFee({ holderId, userId });
  claim.holderId = holderId;
};

/** Moves the held fee to the operation that settles it. */
export const bindRunFee = async (claim: RunFeeClaim, userId: string, operationId: string) => {
  if (!claim.holderId || claim.holderId === operationId) return;
  await rebindAgentRunFee(userId, claim.holderId, operationId);
  claim.holderId = operationId;
};

/** Gives back a fee whose operation never started. */
export const releaseUnstartedRunFee = async (claim: RunFeeClaim, userId: string) => {
  if (!claim.holderId || claim.handedOff) return;
  await releaseAgentRunFee(userId, claim.holderId);
};
