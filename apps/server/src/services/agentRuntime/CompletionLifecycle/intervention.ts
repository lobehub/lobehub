/**
 * Durable Review publication for a run parked on human approval.
 */
import pMap from 'p-map';

import { notifyAgentInterventionRequired } from '@/business/server/agent-run/agentInterventionReview';

import { buildRuntimeInterventionNotification } from '../agentInterventionNotification';
import type { CompletionLifecycleDeps } from './types';

/**
 * A parked human-approval run is not safely published until its generic Review
 * batch is durable. Unlike ordinary notification fanout, this error must reach
 * the queue/request boundary so the idempotent lifecycle delivery can retry.
 */
export class CriticalAgentInterventionPersistenceError extends Error {
  constructor(operationId: string, cause: unknown) {
    super(`Failed to persist intervention Review for parked operation ${operationId}`, { cause });
    this.name = 'CriticalAgentInterventionPersistenceError';
  }
}

/**
 * Publish a provider-neutral Review snapshot only after every referenced tool
 * row can be read back as a member of this exact sealed parked batch. The
 * business slot is idempotent by batch id; repeated lifecycle delivery is
 * therefore safe, while a partial/mismatched write fails closed.
 */
export async function notifyPendingAgentIntervention(
  deps: CompletionLifecycleDeps,
  operationId: string,
  state: any,
): Promise<void> {
  try {
    const notification = await buildRuntimeInterventionNotification({
      operationId,
      state,
      userId: state?.origin?.userId || deps.userId,
      workspaceId: deps.workspaceId,
    });
    if (!notification) return;

    const persistedRows = await pMap(
      notification.items,
      async (item, itemIndex) => {
        if (item.sourceRef.type !== 'runtime') return;
        const [message, plugin] = await Promise.all([
          deps.messageModel.findById(item.sourceRef.toolMessageId),
          deps.messageModel.findMessagePlugin(item.sourceRef.toolMessageId),
        ]);
        if (
          !message ||
          message.role !== 'tool' ||
          message.parentId !== notification.context.assistantMessageId ||
          message.topicId !== notification.context.topicId ||
          !plugin ||
          plugin.toolCallId !== item.sourceRef.toolCallId ||
          plugin.intervention?.status !== 'pending' ||
          plugin.intervention.operationId !== operationId ||
          plugin.intervention.batchId !== notification.batch.id ||
          plugin.intervention.stepIndex !== notification.batch.stepIndex ||
          plugin.intervention.itemIndex !== itemIndex
        ) {
          return;
        }
        return true;
      },
      { concurrency: 5 },
    );

    if (persistedRows.some((persisted) => persisted !== true)) {
      throw new Error(
        'Cannot create intervention Review because the sealed pending batch is not durable',
      );
    }

    // Contract boundary: Cloud resolves only after the generic batch is
    // durable. Push/Live Activity fanout failures are handled inside the
    // Cloud override and must not reject this call after persistence.
    await notifyAgentInterventionRequired(notification);
  } catch (error) {
    if (error instanceof CriticalAgentInterventionPersistenceError) throw error;
    throw new CriticalAgentInterventionPersistenceError(operationId, error);
  }
}
