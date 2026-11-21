import type { AgentInterventionSource } from '@lobechat/types';
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';

import {
  AGENT_INTERVENTION_IDENTITY_CONFLICT,
  AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH,
} from '../../models/agentIntervention/constants';
import type { AgentInterventionContext } from '../../models/agentIntervention/context';
import {
  lockAndTransitionResolution,
  type ResolutionTransition,
} from '../../models/agentIntervention/resolution';
import type { AgentInterventionBatchMutationResult } from '../../models/agentIntervention/types';
import { terminalStatusForAction } from '../../models/agentIntervention/utils';
import {
  type AgentInterventionResolutionItem,
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
} from '../../schemas';
import type { Transaction } from '../../type';
import { rollbackArgumentEffect, rollbackRememberEffect } from './effects';

/**
 * Resolution transitions that also write another aggregate in the same unit
 * of work: a rollback reverts the claim's message-argument and user-settings
 * effects, and a runtime completion retires the parked agent operation.
 */
const transitionAcrossAggregates = (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
  transition: ResolutionTransition,
  options?: { lockOperation?: boolean },
): Promise<AgentInterventionBatchMutationResult> =>
  ctx.db.transaction((tx) =>
    lockAndTransitionResolution(ctx, tx, resolutionRequestId, transition, options),
  );

/** Publish failed before consumption; conditionally reopens only this claim. */
export const rollbackResolution = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
): Promise<AgentInterventionBatchMutationResult> =>
  transitionAcrossAggregates(ctx, resolutionRequestId, async (tx, resolution, rows) => {
    if (resolution.status === 'rolled_back') {
      return { interventions: rows, outcome: 'idempotent', resolution };
    }
    if (resolution.status !== 'resolving') {
      return { interventions: rows, outcome: 'conflict', resolution };
    }
    if (
      resolution.action.type === 'submit_custom' &&
      resolution.customExecutionState !== null &&
      resolution.customExecutionState !== 'pending'
    ) {
      return { interventions: rows, outcome: 'conflict', resolution };
    }

    const now = new Date();
    const argumentRollback = await rollbackArgumentEffect(ctx, tx, resolution, rows);
    const rememberEffectStatus = await rollbackRememberEffect(ctx, tx, resolution);
    const [updatedResolution] = await tx
      .update(agentInterventionResolutions)
      .set({
        argumentEffectStatus: argumentRollback.status,
        rememberEffectStatus,
        rolledBackAt: now,
        status: 'rolled_back',
        updatedAt: now,
        version: sql`${agentInterventionResolutions.version} + 1`,
      })
      .where(eq(agentInterventionResolutions.id, resolution.id))
      .returning();

    const updatedRows = await tx
      .update(agentInterventions)
      .set({
        requestRevisionHash: argumentRollback.requestRevisionHash,
        resolutionId: null,
        resolvingAt: null,
        status: 'pending',
        updatedAt: now,
        version: sql`${agentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventions.resolutionId, resolution.id),
          eq(agentInterventions.status, 'resolving'),
          gt(agentInterventions.deadline, now),
        ),
      )
      .returning();
    const expiredRows = await tx
      .update(agentInterventions)
      .set({
        requestRevisionHash: argumentRollback.requestRevisionHash,
        resolutionId: null,
        resolvedAt: now,
        resolvingAt: null,
        status: 'timed_out',
        updatedAt: now,
        version: sql`${agentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventions.resolutionId, resolution.id),
          eq(agentInterventions.status, 'resolving'),
          lte(agentInterventions.deadline, now),
        ),
      )
      .returning();
    return {
      interventions: [...updatedRows, ...expiredRows].sort(
        (left, right) => left.itemIndex - right.itemIndex,
      ),
      outcome: 'applied',
      resolution: updatedResolution,
    };
  });

/** Runtime rows become terminal once the continuation has durably started. */
export const completeRuntimeResolution = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
  continuationStartedAt = new Date(),
): Promise<AgentInterventionBatchMutationResult> =>
  completeResolution(ctx, resolutionRequestId, 'runtime', continuationStartedAt);

/** Heterogeneous rows become terminal only after the matching producer ACK. */
export const acknowledgeProducerResolution = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
  producerAckAt = new Date(),
): Promise<AgentInterventionBatchMutationResult> =>
  completeResolution(ctx, resolutionRequestId, 'heterogeneous', producerAckAt);

export const retireResolvedRuntimeOperation = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  resolution: AgentInterventionResolutionItem,
  at: Date,
): Promise<void> => {
  if (resolution.action.type === 'stop' || resolution.action.type === 'cancel_interaction') {
    return;
  }
  const completedOperation = await tx
    .update(agentOperations)
    .set({ completedAt: at, completionReason: 'done', status: 'done' })
    .where(
      and(
        eq(agentOperations.id, resolution.operationId),
        eq(agentOperations.status, 'waiting_for_human'),
        eq(agentOperations.userId, ctx.userId),
        ctx.workspaceId
          ? eq(agentOperations.workspaceId, ctx.workspaceId)
          : isNull(agentOperations.workspaceId),
      ),
    )
    .returning({ id: agentOperations.id });
  if (completedOperation.length > 0) return;

  const [operation] = await tx
    .select({ status: agentOperations.status })
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.id, resolution.operationId),
        eq(agentOperations.userId, ctx.userId),
        ctx.workspaceId
          ? eq(agentOperations.workspaceId, ctx.workspaceId)
          : isNull(agentOperations.workspaceId),
      ),
    )
    .limit(1);
  if (operation?.status !== 'done') {
    throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
  }
};

export const completeResolution = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
  source: AgentInterventionSource,
  at: Date,
): Promise<AgentInterventionBatchMutationResult> =>
  transitionAcrossAggregates(
    ctx,
    resolutionRequestId,
    async (tx, resolution, rows) => {
      if (resolution.source !== source) {
        throw new Error(AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH);
      }
      const terminalResolutionStatus = source === 'runtime' ? 'completed' : 'acknowledged';
      if (resolution.status === terminalResolutionStatus) {
        if (source === 'runtime') {
          await retireResolvedRuntimeOperation(ctx, tx, resolution, at);
        }
        return { interventions: rows, outcome: 'idempotent', resolution };
      }
      if (resolution.status !== 'published') {
        return { interventions: rows, outcome: 'conflict', resolution };
      }
      const [updatedResolution] = await tx
        .update(agentInterventionResolutions)
        .set({
          continuationStartedAt: source === 'runtime' ? at : undefined,
          producerAckAt: source === 'heterogeneous' ? at : undefined,
          status: terminalResolutionStatus,
          terminalAt: at,
          updatedAt: at,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(eq(agentInterventionResolutions.id, resolution.id))
        .returning();
      const updatedRows = await tx
        .update(agentInterventions)
        .set({
          producerAckAt: source === 'heterogeneous' ? at : undefined,
          resolvedAt: at,
          status: terminalStatusForAction(resolution.action),
          updatedAt: at,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            eq(agentInterventions.resolutionId, resolution.id),
            eq(agentInterventions.status, 'published'),
          ),
        )
        .returning();
      if (source === 'runtime') {
        await retireResolvedRuntimeOperation(ctx, tx, resolution, at);
      }
      return { interventions: updatedRows, outcome: 'applied', resolution: updatedResolution };
    },
    { lockOperation: source === 'runtime' },
  );
