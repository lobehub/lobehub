import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import {
  type AgentInterventionItem,
  type AgentInterventionResolutionItem,
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
} from '../../schemas';
import type { Transaction } from '../../type';
import { AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH, UUID_PATTERN } from './constants';
import { type AgentInterventionContext, resolutionOwnership } from './context';
import type { AgentInterventionBatchMutationResult } from './types';

export const markResolutionPublished = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
  publishedAt = new Date(),
): Promise<AgentInterventionBatchMutationResult> =>
  transitionResolution(ctx, resolutionRequestId, async (tx, resolution, rows) => {
    if (resolution.status === 'published' || resolution.status === 'completed') {
      return { interventions: rows, outcome: 'idempotent', resolution };
    }
    if (resolution.status !== 'resolving') {
      return { interventions: rows, outcome: 'conflict', resolution };
    }

    const [updatedResolution] = await tx
      .update(agentInterventionResolutions)
      .set({
        publishedAt,
        status: 'published',
        updatedAt: publishedAt,
        version: sql`${agentInterventionResolutions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventionResolutions.id, resolution.id),
          eq(agentInterventionResolutions.status, 'resolving'),
        ),
      )
      .returning();
    const updatedRows = await tx
      .update(agentInterventions)
      .set({
        publishedAt,
        status: 'published',
        updatedAt: publishedAt,
        version: sql`${agentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventions.resolutionId, resolution.id),
          eq(agentInterventions.status, 'resolving'),
        ),
      )
      .returning();
    return { interventions: updatedRows, outcome: 'applied', resolution: updatedResolution };
  });

/** Late heterogeneous ACK is audited without overwriting timeout/session outcome. */
export const recordProducerAck = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
  producerAckAt = new Date(),
): Promise<AgentInterventionBatchMutationResult> =>
  transitionResolution(ctx, resolutionRequestId, async (tx, resolution, rows) => {
    if (resolution.source !== 'heterogeneous') {
      throw new Error(AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH);
    }
    if (resolution.producerAckAt) {
      return { interventions: rows, outcome: 'idempotent', resolution };
    }
    if (!['timed_out', 'session_ended'].includes(resolution.status)) {
      return { interventions: rows, outcome: 'conflict', resolution };
    }
    const [updatedResolution] = await tx
      .update(agentInterventionResolutions)
      .set({
        producerAckAt,
        updatedAt: producerAckAt,
        version: sql`${agentInterventionResolutions.version} + 1`,
      })
      .where(eq(agentInterventionResolutions.id, resolution.id))
      .returning();
    const updatedRows = await tx
      .update(agentInterventions)
      .set({
        producerAckAt,
        updatedAt: producerAckAt,
        version: sql`${agentInterventions.version} + 1`,
      })
      .where(eq(agentInterventions.resolutionId, resolution.id))
      .returning();
    return { interventions: updatedRows, outcome: 'applied', resolution: updatedResolution };
  });

export const findResolutionByRequestId = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
): Promise<AgentInterventionResolutionItem | undefined> => {
  if (!UUID_PATTERN.test(resolutionRequestId)) return undefined;
  const [row] = await ctx.db
    .select()
    .from(agentInterventionResolutions)
    .where(
      and(
        eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId),
        resolutionOwnership(ctx),
      ),
    )
    .limit(1);
  return row;
};

export type ResolutionTransition = (
  tx: Transaction,
  resolution: AgentInterventionResolutionItem,
  rows: AgentInterventionItem[],
) => Promise<AgentInterventionBatchMutationResult>;

/**
 * Locks one resolution and its intervention rows inside the caller's
 * transaction, then runs `transition`. With `lockOperation`, the owning
 * operation row is locked first (read-only) so a transition that retires it
 * keeps a stable lock order.
 */
export const lockAndTransitionResolution = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  resolutionRequestId: string,
  transition: ResolutionTransition,
  options?: { lockOperation?: boolean },
): Promise<AgentInterventionBatchMutationResult> => {
  const [candidate] = await tx
    .select({
      id: agentInterventionResolutions.id,
      operationId: agentInterventionResolutions.operationId,
    })
    .from(agentInterventionResolutions)
    .where(
      and(
        eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId),
        resolutionOwnership(ctx),
      ),
    )
    .limit(1);
  if (!candidate) return { outcome: 'not_found' };

  if (options?.lockOperation) {
    const [operation] = await tx
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, candidate.operationId),
          eq(agentOperations.userId, ctx.userId),
          ctx.workspaceId
            ? eq(agentOperations.workspaceId, ctx.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      )
      .limit(1)
      .for('update');
    if (!operation) return { outcome: 'not_found' };
  }

  // Batch terminal transitions lock intervention rows before their linked
  // resolutions. Preserve that order here to avoid timeout/ACK deadlocks.
  const rows = await tx
    .select()
    .from(agentInterventions)
    .where(eq(agentInterventions.resolutionId, candidate.id))
    .orderBy(asc(agentInterventions.itemIndex))
    .for('update');
  const [resolution] = await tx
    .select()
    .from(agentInterventionResolutions)
    .where(and(eq(agentInterventionResolutions.id, candidate.id), resolutionOwnership(ctx)))
    .limit(1)
    .for('update');
  if (!resolution) return { outcome: 'not_found' };
  return transition(tx, resolution, rows);
};

/** Runs a transition that writes only this aggregate's resolution and intervention rows. */
export const transitionResolution = async (
  ctx: AgentInterventionContext,
  resolutionRequestId: string,
  transition: ResolutionTransition,
): Promise<AgentInterventionBatchMutationResult> =>
  ctx.db.transaction((tx) => lockAndTransitionResolution(ctx, tx, resolutionRequestId, transition));
