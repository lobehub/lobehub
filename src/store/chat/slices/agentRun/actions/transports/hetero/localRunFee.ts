import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ChatMessageError, ConversationContext } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

import { aiAgentService } from '@/services/aiAgent';

/**
 * The run fee of an external agent this desktop spawns itself. Such a run
 * never passes through the server's `execAgent`, so the executor reports it:
 * {@link claimLocalRunFee} before spawning the CLI, {@link settleLocalRunFee}
 * once it ends.
 */
export interface LocalRunFeeClaim {
  /** Set while a fee is held; cleared once it is settled. */
  feeId?: string | null;
  /** When the hold was requested, the start of the duration Desktop reports. */
  startedAt?: number;
  /** When the user stopped the run; cleanup after it does not count toward its duration. */
  stoppedAt?: number;
  /** Scope the run started in; the fee is held and settled there, whatever the UI switches to. */
  workspaceId?: string | null;
}

export type LocalRunEndReason = 'done' | 'error' | 'interrupted';

/** A hold slower than this lets the run start without a fee rather than stall the CLI. */
export const LOCAL_RUN_FEE_HOLD_TIMEOUT_MS = 5000;

/** A settle slower than this is dropped so the run can finish; the hold then expires by itself. */
export const LOCAL_RUN_FEE_SETTLE_TIMEOUT_MS = 10_000;

/**
 * Whether this run reports its fee, with the exemptions of the server's
 * `shouldHoldRunFee`: a continuation of a run that already held one (restart
 * recovery, continue-after-error, transcript replay) and a sub-agent or group
 * member, which are steps of their root run. Workspace runs are exempted by the
 * server.
 */
export const shouldClaimLocalRunFee = ({
  context,
  continuesRun,
  replayTranscript,
}: {
  context: ConversationContext;
  continuesRun?: boolean;
  replayTranscript?: boolean;
}): boolean =>
  !continuesRun &&
  !replayTranscript &&
  context.scope !== 'sub_agent' &&
  !context.isSubAgent &&
  context.orchestrationRole !== 'member';

const unfundedRunFeeError = (): ChatMessageError => ({
  body: {},
  message: `response.${ChatErrorType.InsufficientBudgetForAgentRunFee}`,
  type: ChatErrorType.InsufficientBudgetForAgentRunFee,
});

/**
 * Holds the fee, or returns the error to show when the server refuses it
 * because the balance cannot cover it; the CLI must not start then.
 *
 * Any other failure (a server without this endpoint, a network blip, a hold
 * slower than {@link LOCAL_RUN_FEE_HOLD_TIMEOUT_MS}) lets the run go ahead
 * without a fee, as the server's own hold does on failures that are not a
 * refusal: a run fee is not worth failing a run the user started.
 *
 * Returns `'stopped'`, with any held fee already given back as interrupted,
 * when the user stopped the run before or during the hold: the CLI must not
 * start then either.
 */
export const claimLocalRunFee = async (
  claim: LocalRunFeeClaim,
  run: {
    context: ConversationContext;
    continuesRun?: boolean;
    replayTranscript?: boolean;
    workspaceId?: string | null;
  },
  /** The operation's Stop signal: it ends a pending hold and marks when the run stopped. */
  abortSignal?: AbortSignal,
): Promise<ChatMessageError | 'stopped' | undefined> => {
  if (abortSignal?.aborted) return 'stopped';
  if (!shouldClaimLocalRunFee(run)) return;
  claim.startedAt = Date.now();
  claim.workspaceId = run.workspaceId ?? null;
  abortSignal?.addEventListener('abort', () => (claim.stoppedAt ??= Date.now()), { once: true });
  const timeout = AbortSignal.timeout(LOCAL_RUN_FEE_HOLD_TIMEOUT_MS);
  try {
    const { feeId } = await aiAgentService.beginLocalHeteroRunFee(
      { topicId: run.context.topicId ?? undefined },
      {
        signal: abortSignal ? AbortSignal.any([timeout, abortSignal]) : timeout,
        workspaceId: claim.workspaceId,
      },
    );
    claim.feeId = feeId;
  } catch (error) {
    if ((error as Error)?.message === ChatErrorType.InsufficientBudgetForAgentRunFee)
      return unfundedRunFeeError();
    if (!abortSignal?.aborted)
      console.error('[HeterogeneousAgent] run fee hold failed; running without it:', error);
  }
  if (!abortSignal?.aborted) return;
  await settleLocalRunFee(claim, { aborted: true, failed: false });
  return 'stopped';
};

/**
 * Charges or gives back the held fee. Runs at most once per claim, and never
 * throws or hangs: an unsettled hold expires on the server by itself.
 */
export const settleLocalRunFee = async (
  claim: LocalRunFeeClaim,
  ending: {
    aborted: boolean;
    /** The executor persisted a terminal error. */
    failed: boolean;
    /** The deferred terminal stream event, when the CLI sent one. */
    terminal?: AgentStreamEvent | null;
  },
) => {
  const feeId = claim.feeId;
  if (!feeId) return;
  claim.feeId = undefined;
  const reason = resolveLocalRunEndReason({
    aborted: ending.aborted,
    failed: ending.failed || ending.terminal?.type === 'error',
    runtimeEndReason: (ending.terminal?.data as { reason?: string } | undefined)?.reason,
  });
  const endedAt = claim.stoppedAt ?? Date.now();
  try {
    await aiAgentService.finishLocalHeteroRunFee(
      {
        durationMs:
          claim.startedAt === undefined ? undefined : Math.max(0, endedAt - claim.startedAt),
        feeId,
        reason,
      },
      {
        signal: AbortSignal.timeout(LOCAL_RUN_FEE_SETTLE_TIMEOUT_MS),
        workspaceId: claim.workspaceId ?? null,
      },
    );
  } catch (error) {
    console.error('[HeterogeneousAgent] run fee settle failed:', error);
  }
};

/**
 * The end reason the server's fee rules read, from how the executor saw the run
 * end. A stop counts as `interrupted`, which the deployment's rules settle; a failure
 * gives the fee back; any other ending, including a run that exits cleanly
 * without an explicit reason, is a finished run.
 */
export const resolveLocalRunEndReason = ({
  aborted,
  failed,
  runtimeEndReason,
}: {
  aborted: boolean;
  /** The executor persisted a terminal error, or the stream ended on one. */
  failed: boolean;
  /** `agent_runtime_end` reason, when the CLI reported one. */
  runtimeEndReason?: string;
}): LocalRunEndReason => {
  if (aborted || runtimeEndReason === 'interrupted' || runtimeEndReason === 'cancelled')
    return 'interrupted';
  if (failed || runtimeEndReason === 'error') return 'error';
  return 'done';
};
