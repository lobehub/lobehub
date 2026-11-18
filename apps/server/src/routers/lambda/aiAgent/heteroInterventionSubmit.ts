import { randomUUID } from 'node:crypto';

import debug from 'debug';
import { z } from 'zod';

import {
  onHeteroInterventionResolutionPublished,
  resolveHeteroIntervention,
  rollbackHeteroInterventionResolution,
} from '@/business/server/agent-run/heteroInterventionReview';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';

const log = debug('lobe-server:ai-agent-hetero-intervention');

/**
 * Schema for `aiAgent.submitHeteroIntervention` — the browser leg of remote
 * Human-in-the-loop. The user's answer to an `agent_intervention_request` is
 * published back onto the op's Redis stream as an `agent_intervention_response`,
 * where both the renderer (card → resolved) and the exec long-poll converge on
 * it by `toolCallId`. Mutually exclusive: `result` on submit, `cancelled` on
 * skip/cancel.
 */
export const SubmitHeteroInterventionSchema = z.object({
  cancelReason: z.enum(['timeout', 'user_cancelled', 'session_ended']).optional(),
  cancelled: z.boolean().optional(),
  operationId: z.string().min(1),
  /** Optional only for backward compatibility with pre-contract Web clients. */
  resolutionRequestId: z.string().uuid().optional(),
  result: z.unknown().optional(),
  /** Producer step index; harmless placeholder — correlation is by toolCallId. */
  stepIndex: z.number().int().nonnegative().default(0),
  toolCallId: z.string().min(1),
});

export type SubmitHeteroInterventionInput = z.input<typeof SubmitHeteroInterventionSchema>;

export const publishClaimedHeteroIntervention = async (params: {
  claim: Extract<
    Awaited<ReturnType<typeof resolveHeteroIntervention>>,
    { handled: true; state: 'claimed' }
  >;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { claim, userId, workspaceId } = params;
  const resolvedWorkspaceId = claim.workspaceId ?? workspaceId ?? undefined;
  const streamEventManager = createStreamEventManager();

  try {
    await streamEventManager.publishStreamEvent(claim.operationId, {
      data: {
        ...claim.response,
        producerAck: false,
        resolutionRequestId: claim.resolutionRequestId,
      },
      stepIndex: claim.stepIndex ?? 0,
      type: 'agent_intervention_response',
    });
  } catch (error) {
    await rollbackHeteroInterventionResolution({
      claimId: claim.claimId,
      operationId: claim.operationId,
      resolutionRequestId: claim.resolutionRequestId,
      toolCallId: claim.response.toolCallId,
      userId,
      workspaceId: resolvedWorkspaceId,
    }).catch((rollbackError) => {
      log(
        'conditional intervention rollback failed claim=%s op=%s: %O',
        claim.claimId,
        claim.operationId,
        rollbackError,
      );
    });
    throw error;
  }

  // Notification surfaces may switch to `resolving` only after XADD has
  // succeeded. This best-effort side effect must not roll back a response the
  // producer can already consume from the stream.
  await onHeteroInterventionResolutionPublished({
    claimId: claim.claimId,
    operationId: claim.operationId,
    resolutionRequestId: claim.resolutionRequestId,
    status: 'resolving',
    toolCallId: claim.response.toolCallId,
    userId,
    workspaceId: resolvedWorkspaceId,
  }).catch((notificationError) => {
    log(
      'intervention published hook failed claim=%s op=%s: %O',
      claim.claimId,
      claim.operationId,
      notificationError,
    );
  });

  return {
    // XADD only acknowledges transport acceptance. The producer's echoed
    // response is the authoritative terminal transition persisted by the
    // intervention reducer; until then the durable row remains resolving.
    status: 'resolving' as const,
    success: true as const,
  };
};

/**
 * Publish a browser answer to a remote hetero question once the caller has
 * been authorized for the operation. `userId` / `workspaceId` are the
 * operation owner's scope: the owner themselves, or the creator of a share
 * whose visitor is answering their own running operation.
 */
export const submitHeteroInterventionAs = async (
  input: z.output<typeof SubmitHeteroInterventionSchema>,
  owner: { userId: string; workspaceId?: string | null },
) => {
  const ctx = { userId: owner.userId, workspaceId: owner.workspaceId ?? undefined };
  const {
    operationId,
    toolCallId,
    stepIndex,
    result,
    cancelled,
    resolutionRequestId = randomUUID(),
  } = input;

  // Cloud overrides this as an atomic first-winner claim shared by Web and
  // Mobile. OSS returns `handled:false` and preserves the legacy stream
  // publish below. A claimed response is authoritative: client-supplied
  // operation/tool fields cannot override what Cloud resolved durably.
  const businessResolution = await resolveHeteroIntervention({
    action: cancelled ? 'skip' : 'submit',
    cancelReason: cancelled ? 'user_cancelled' : undefined,
    result: cancelled ? undefined : result,
    resolutionRequestId,
    target: { operationId, toolCallId },
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? undefined,
  });
  if (businessResolution.handled) {
    if (businessResolution.state === 'already_resolved') {
      return { status: businessResolution.status, success: true as const };
    }
    return publishClaimedHeteroIntervention({
      claim: businessResolution,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
  }

  const streamEventManager = createStreamEventManager();
  await streamEventManager.publishStreamEvent(operationId, {
    data: {
      // Client-driven cancellation cannot impersonate producer timeout or
      // session teardown; those terminal reasons originate from bridge ACKs.
      cancelReason: cancelled ? 'user_cancelled' : undefined,
      cancelled,
      producerAck: false,
      result: cancelled ? undefined : result,
      resolutionRequestId,
      toolCallId,
    },
    stepIndex,
    type: 'agent_intervention_response',
  });

  return { status: 'resolving' as const, success: true as const };
};
