import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { AGENT_INTERVENTION_IDENTITY_CONFLICT } from '../../models/agentIntervention/constants';
import {
  type AgentInterventionContext,
  ownership,
  resolutionOwnership,
} from '../../models/agentIntervention/context';
import {
  createBatchInTransaction,
  isSameCreateBatch,
  validateCreateBatch,
} from '../../models/agentIntervention/creation';
import type {
  AgentInterventionBatchSupersessionResult,
  AgentInterventionOperationIdentity,
  CreateAgentInterventionBatchWithSupersessionParams,
} from '../../models/agentIntervention/types';
import {
  asRecord,
  sameJson,
  terminalStatusForAction,
  uniqueSorted,
} from '../../models/agentIntervention/utils';
import { agentInterventionResolutions, agentInterventions, agentOperations } from '../../schemas';

/**
 * Atomically replaces the still-pending remainder of a runtime batch after a
 * partial decision re-parks under a new operation. The new parked batch is
 * causal proof that the prior runtime continuation started, so an in-flight
 * winning resolution may be completed here before its published hook arrives.
 */
export const createBatchWithSupersession = async (
  ctx: AgentInterventionContext,
  params: CreateAgentInterventionBatchWithSupersessionParams,
): Promise<AgentInterventionBatchSupersessionResult> => {
  const { batch, supersedes } = params;
  validateCreateBatch(batch);
  if (!supersedes) {
    return ctx.db.transaction(async (tx) => {
      const [ownedOperation] = await tx
        .select({ id: agentOperations.id, status: agentOperations.status })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.id, batch.operationId),
            eq(agentOperations.userId, ctx.userId),
            ctx.workspaceId
              ? eq(agentOperations.workspaceId, ctx.workspaceId)
              : isNull(agentOperations.workspaceId),
          ),
        )
        .limit(1)
        .for('update');
      if (!ownedOperation) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      const existing = await tx
        .select({ id: agentInterventions.id })
        .from(agentInterventions)
        .where(
          and(
            eq(agentInterventions.operationId, batch.operationId),
            eq(agentInterventions.batchId, batch.batchId),
            ownership(ctx),
          ),
        )
        .limit(1)
        .for('update');
      if (
        existing.length === 0 &&
        batch.source === 'runtime' &&
        ownedOperation.status !== 'waiting_for_human'
      ) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }
      const interventions = await createBatchInTransaction(ctx, tx, batch, ownedOperation.status);
      return {
        interventions,
        outcome: existing.length > 0 ? 'idempotent' : 'applied',
      };
    });
  }

  const supersededToolCallIds = uniqueSorted(supersedes.toolCallIds);
  const newToolCallIds = uniqueSorted(batch.items.map((item) => item.toolCallId));
  if (
    batch.source !== 'runtime' ||
    batch.operationId === supersedes.operationId ||
    batch.batchId === supersedes.batchId ||
    batch.activityKey === supersedes.activityKey ||
    supersededToolCallIds.length === 0 ||
    supersededToolCallIds.length !== supersedes.toolCallIds.length ||
    !sameJson(supersededToolCallIds, newToolCallIds)
  ) {
    throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
  }

  return ctx.db.transaction(async (tx) => {
    const operationIds = uniqueSorted([supersedes.operationId, batch.operationId]);
    const operations = await tx
      .select({
        agentId: agentOperations.agentId,
        appContext: agentOperations.appContext,
        chatGroupId: agentOperations.chatGroupId,
        id: agentOperations.id,
        status: agentOperations.status,
        taskId: agentOperations.taskId,
        threadId: agentOperations.threadId,
        topicId: agentOperations.topicId,
      })
      .from(agentOperations)
      .where(
        and(
          inArray(agentOperations.id, operationIds),
          eq(agentOperations.userId, ctx.userId),
          ctx.workspaceId
            ? eq(agentOperations.workspaceId, ctx.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      )
      .orderBy(asc(agentOperations.id))
      .for('update');
    if (operations.length !== operationIds.length) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }
    const oldOperation = operations.find(({ id }) => id === supersedes.operationId);
    const newOperation = operations.find(({ id }) => id === batch.operationId);
    if (
      !oldOperation ||
      !newOperation ||
      !['waiting_for_human', 'done'].includes(oldOperation.status) ||
      !['waiting_for_human', 'done'].includes(newOperation.status) ||
      !hasSameOperationContext(oldOperation, newOperation)
    ) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    const lockedRows = await tx
      .select()
      .from(agentInterventions)
      .where(
        and(
          ownership(ctx),
          or(
            and(
              eq(agentInterventions.operationId, supersedes.operationId),
              eq(agentInterventions.batchId, supersedes.batchId),
            ),
            and(
              eq(agentInterventions.operationId, batch.operationId),
              eq(agentInterventions.batchId, batch.batchId),
            ),
          ),
        ),
      )
      .orderBy(
        asc(agentInterventions.operationId),
        asc(agentInterventions.batchId),
        asc(agentInterventions.itemIndex),
        asc(agentInterventions.id),
      )
      .for('update');
    const oldRows = lockedRows
      .filter(
        (row) => row.operationId === supersedes.operationId && row.batchId === supersedes.batchId,
      )
      .sort((left, right) => left.itemIndex - right.itemIndex);
    const existingNewRows = lockedRows
      .filter((row) => row.operationId === batch.operationId && row.batchId === batch.batchId)
      .sort((left, right) => left.itemIndex - right.itemIndex);

    if (
      oldRows.length === 0 ||
      oldRows.some(
        (row, index) =>
          !row.sealed ||
          row.source !== 'runtime' ||
          row.activityKey !== supersedes.activityKey ||
          row.itemCount !== oldRows.length ||
          row.itemIndex !== index,
      )
    ) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }
    if (existingNewRows.length > 0 && !isSameCreateBatch(existingNewRows, batch)) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    const oldPendingRows = oldRows.filter((row) => row.status === 'pending');
    const activeOldRows = oldRows.filter((row) => ['resolving', 'published'].includes(row.status));
    const activeResolutionIds = uniqueSorted(
      activeOldRows.flatMap((row) => (row.resolutionId ? [row.resolutionId] : [])),
    );

    if (existingNewRows.length > 0) {
      const movedRows = oldRows.filter((row) => supersededToolCallIds.includes(row.toolCallId));
      if (
        oldPendingRows.length > 0 ||
        activeOldRows.length > 0 ||
        movedRows.length !== supersededToolCallIds.length ||
        movedRows.some((row) => row.status !== 'session_ended') ||
        oldOperation.status !== 'done'
      ) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }
      return {
        interventions: existingNewRows,
        outcome: 'idempotent',
        superseded: {
          activityKey: supersedes.activityKey,
          batchId: supersedes.batchId,
          interventions: oldRows,
          operationId: supersedes.operationId,
        },
      };
    }

    // A replacement may only be created while its new runtime operation is
    // still parked. The broader status allowance above exists solely so an
    // exact, already-created replacement can be replayed idempotently after
    // its continuation has advanced the operation to done.
    if (newOperation.status !== 'waiting_for_human') {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    if (
      !sameJson(uniqueSorted(oldPendingRows.map((row) => row.toolCallId)), supersededToolCallIds) ||
      activeResolutionIds.length > 1 ||
      activeOldRows.some((row) => !row.resolutionId)
    ) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    const now = new Date();
    if (activeResolutionIds.length === 1) {
      const [resolution] = await tx
        .select()
        .from(agentInterventionResolutions)
        .where(
          and(
            eq(agentInterventionResolutions.id, activeResolutionIds[0]),
            resolutionOwnership(ctx),
          ),
        )
        .limit(1)
        .for('update');
      const activeIds = uniqueSorted(activeOldRows.map((row) => row.id));
      if (
        !resolution ||
        resolution.source !== 'runtime' ||
        resolution.operationId !== supersedes.operationId ||
        resolution.batchId !== supersedes.batchId ||
        !['resolving', 'published'].includes(resolution.status) ||
        resolution.action.type === 'stop' ||
        resolution.action.type === 'cancel_interaction' ||
        !sameJson(uniqueSorted(resolution.selectedInterventionIds), activeIds)
      ) {
        throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      }
      await tx
        .update(agentInterventionResolutions)
        .set({
          continuationStartedAt: now,
          publishedAt: resolution.publishedAt ?? now,
          status: 'completed',
          terminalAt: now,
          updatedAt: now,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(eq(agentInterventionResolutions.id, resolution.id));
      await tx
        .update(agentInterventions)
        .set({
          resolvedAt: now,
          status: terminalStatusForAction(resolution.action),
          updatedAt: now,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventions.resolutionId, resolution.id),
            inArray(agentInterventions.status, ['resolving', 'published']),
          ),
        );
    }

    const movedRows = await tx
      .update(agentInterventions)
      .set({
        resolvedAt: now,
        status: 'session_ended',
        updatedAt: now,
        version: sql`${agentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventions.operationId, supersedes.operationId),
          eq(agentInterventions.batchId, supersedes.batchId),
          eq(agentInterventions.status, 'pending'),
          inArray(agentInterventions.toolCallId, supersededToolCallIds),
          ownership(ctx),
        ),
      )
      .returning();
    if (movedRows.length !== supersededToolCallIds.length) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }

    await tx
      .update(agentOperations)
      .set({ completedAt: now, completionReason: 'done', status: 'done' })
      .where(
        and(
          eq(agentOperations.id, supersedes.operationId),
          eq(agentOperations.status, 'waiting_for_human'),
          eq(agentOperations.userId, ctx.userId),
          ctx.workspaceId
            ? eq(agentOperations.workspaceId, ctx.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      );

    const interventions = await createBatchInTransaction(ctx, tx, batch, newOperation.status);
    const supersededRows = await tx
      .select()
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, supersedes.operationId),
          eq(agentInterventions.batchId, supersedes.batchId),
          ownership(ctx),
        ),
      )
      .orderBy(asc(agentInterventions.itemIndex));
    return {
      interventions,
      outcome: 'applied',
      superseded: {
        activityKey: supersedes.activityKey,
        batchId: supersedes.batchId,
        interventions: supersededRows,
        operationId: supersedes.operationId,
      },
    };
  });
};

export const hasSameOperationContext = (
  left: AgentInterventionOperationIdentity,
  right: AgentInterventionOperationIdentity,
): boolean => {
  const leftContext = asRecord(left.appContext);
  const rightContext = asRecord(right.appContext);
  return (
    left.agentId === right.agentId &&
    left.chatGroupId === right.chatGroupId &&
    left.taskId === right.taskId &&
    left.threadId === right.threadId &&
    left.topicId === right.topicId &&
    sameJson(
      {
        documentId: leftContext.documentId ?? null,
        groupId: leftContext.groupId ?? null,
        scope: leftContext.scope ?? null,
        sessionId: leftContext.sessionId ?? null,
      },
      {
        documentId: rightContext.documentId ?? null,
        groupId: rightContext.groupId ?? null,
        scope: rightContext.scope ?? null,
        sessionId: rightContext.sessionId ?? null,
      },
    )
  );
};
