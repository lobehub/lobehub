import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import {
  AGENT_INTERVENTION_INVALID_ACTION,
  AGENT_INTERVENTION_INVALID_BATCH,
  AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED,
  UUID_PATTERN,
} from '../../models/agentIntervention/constants';
import {
  type AgentInterventionContext,
  ownership,
  resolutionOwnership,
} from '../../models/agentIntervention/context';
import { markRowsTerminalInTransaction } from '../../models/agentIntervention/lookup';
import { findResolutionByRequestId } from '../../models/agentIntervention/resolution';
import type {
  AgentInterventionBatchMutationResult,
  ClaimAgentInterventionBatchParams,
} from '../../models/agentIntervention/types';
import {
  hasExactKeys,
  isCanonicalJsonSafe,
  sameJson,
  uniqueSorted,
} from '../../models/agentIntervention/utils';
import {
  hasValidSealedSnapshot,
  hasValidSelection,
  validateAction,
} from '../../models/agentIntervention/validation';
import {
  type AgentInterventionResolutionItem,
  agentInterventionResolutions,
  agentInterventions,
} from '../../schemas';
import { isUniqueViolation } from '../../utils/uniqueViolation';
import { applyArgumentEffect, applyRememberEffect } from './effects';

/**
 * Atomically validates a complete sealed Review snapshot and claims one,
 * selected, or all pending items. The resolving actor is explicit and may be
 * different from the operation owner after the service has applied ACL.
 */
export const claimBatch = async (
  ctx: AgentInterventionContext,
  params: ClaimAgentInterventionBatchParams,
): Promise<AgentInterventionBatchMutationResult> => {
  if (!UUID_PATTERN.test(params.resolutionRequestId)) {
    throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
  }
  if (!isCanonicalJsonSafe(params.action)) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }

  const existingRequest = await findResolutionByRequestId(ctx, params.resolutionRequestId);
  if (existingRequest) return resolveIdempotentClaim(ctx, existingRequest, params);

  try {
    return await ctx.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(agentInterventions)
        .where(
          and(
            eq(agentInterventions.operationId, params.operationId),
            eq(agentInterventions.batchId, params.batchId),
            ownership(ctx),
          ),
        )
        .orderBy(asc(agentInterventions.itemIndex))
        .for('update');
      if (rows.length === 0) return { outcome: 'not_found' };

      const now = new Date();
      const overdue = rows.filter(
        (row) =>
          ['pending', 'resolving', 'published'].includes(row.status) &&
          row.deadline.getTime() <= now.getTime(),
      );
      if (overdue.length > 0) {
        const terminalRows = await markRowsTerminalInTransaction(ctx, tx, rows, 'timed_out', now);
        return { interventions: terminalRows, outcome: 'conflict' };
      }

      const batchIds = rows.map((row) => row.id);
      if (!hasValidSealedSnapshot(rows, params)) {
        return { interventions: rows, outcome: 'conflict' };
      }

      const selectedIds = uniqueSorted(params.selectedInterventionIds);
      // Stopping an operation settles only the callbacks that are still pending.
      // The caller still supplies the complete sealed-batch snapshot for CAS, but
      // already terminal siblings must remain immutable.
      const targetIds =
        params.action.type === 'stop'
          ? selectedIds
          : params.scope === 'all'
            ? [...batchIds].sort()
            : selectedIds;
      const targets = rows.filter((row) => targetIds.includes(row.id));
      if (!hasValidSelection(rows, targets, params, selectedIds)) {
        return { interventions: rows, outcome: 'conflict' };
      }
      if (targets.some((row) => row.status !== 'pending')) {
        return { interventions: rows, outcome: 'conflict' };
      }

      validateAction(ctx, targets, params);

      const argumentEffect = await applyArgumentEffect(ctx, tx, targets, params.action);

      let rememberToolKey: null | string = null;
      let rememberEffectStatus: 'applied' | 'retained' | null = null;
      if (params.action.type === 'approve_remember') {
        const remember = await applyRememberEffect(ctx, tx, params.actorId, targets[0]);
        rememberToolKey = remember.toolKey;
        rememberEffectStatus = remember.status;
      }

      const [resolution] = await tx
        .insert(agentInterventionResolutions)
        .values({
          action: params.action,
          argumentEffectStatus: argumentEffect ? 'applied' : null,
          actorId: params.actorId,
          batchId: params.batchId,
          customExecutionAttempt: params.action.type === 'submit_custom' ? 0 : null,
          customExecutionState: params.action.type === 'submit_custom' ? 'pending' : null,
          expectedItemCount: params.expectedItemCount,
          expectedRequestRevisionHashes: params.expectedRequestRevisionHashes,
          expectedVersions: params.expectedVersions,
          operationId: rows[0].operationId,
          editedArguments: argumentEffect?.editedArguments,
          editedRequestRevisionHash: argumentEffect?.editedRequestRevisionHash,
          originalArguments: argumentEffect?.originalArguments,
          originalRequestRevisionHash: argumentEffect?.originalRequestRevisionHash,
          rememberEffectStatus,
          rememberToolKey,
          resolutionRequestId: params.resolutionRequestId,
          scope: params.scope,
          selectedInterventionIds: targetIds,
          source: rows[0].source,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? null,
        })
        .returning();

      const claimed = await tx
        .update(agentInterventions)
        .set({
          requestRevisionHash: argumentEffect?.editedRequestRevisionHash,
          resolutionId: resolution.id,
          resolvingAt: now,
          status: 'resolving',
          updatedAt: now,
          version: sql`${agentInterventions.version} + 1`,
        })
        .where(
          and(
            inArray(agentInterventions.id, targetIds),
            ownership(ctx),
            eq(agentInterventions.status, 'pending'),
            gt(agentInterventions.deadline, now),
          ),
        )
        .returning();
      if (claimed.length !== targetIds.length) throw new Error(AGENT_INTERVENTION_INVALID_BATCH);

      const updatedRows = rows.map((row) => claimed.find((item) => item.id === row.id) ?? row);
      return { interventions: updatedRows, outcome: 'applied', resolution };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await findResolutionByRequestId(ctx, params.resolutionRequestId);
      if (existing) return resolveIdempotentClaim(ctx, existing, params);
      throw new Error(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED, { cause: error });
    }
    throw error;
  }
};

export const resolveIdempotentClaim = async (
  ctx: AgentInterventionContext,
  resolution: AgentInterventionResolutionItem,
  params: ClaimAgentInterventionBatchParams,
): Promise<AgentInterventionBatchMutationResult> => {
  if (!isSameResolutionRequest(resolution, params)) {
    throw new Error(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED);
  }
  if (resolution.status === 'rolled_back') {
    return reactivateRolledBackResolution(ctx, resolution.id, params);
  }
  const interventions = await ctx.db
    .select()
    .from(agentInterventions)
    .where(eq(agentInterventions.resolutionId, resolution.id))
    .orderBy(asc(agentInterventions.itemIndex));
  return { interventions, outcome: 'idempotent', resolution };
};

export const isSameResolutionRequest = (
  resolution: AgentInterventionResolutionItem,
  params: ClaimAgentInterventionBatchParams,
): boolean =>
  resolution.operationId === params.operationId &&
  resolution.batchId === params.batchId &&
  resolution.actorId === params.actorId &&
  resolution.expectedItemCount === params.expectedItemCount &&
  resolution.scope === params.scope &&
  sameJson(resolution.selectedInterventionIds, uniqueSorted(params.selectedInterventionIds)) &&
  sameJson(resolution.expectedVersions, params.expectedVersions) &&
  sameJson(resolution.expectedRequestRevisionHashes, params.expectedRequestRevisionHashes) &&
  sameJson(resolution.action, params.action);

/**
 * A transport failure rolls a claim back to pending but clients intentionally
 * retain the same resolutionRequestId: changing it after an ambiguous
 * response could execute the action twice. Reactivate that exact request only
 * while its complete original snapshot is still pending and unchanged. A new
 * winner, an argument edit, timeout, or any identity drift fails closed.
 */
export const reactivateRolledBackResolution = async (
  ctx: AgentInterventionContext,
  resolutionId: string,
  params: ClaimAgentInterventionBatchParams,
): Promise<AgentInterventionBatchMutationResult> =>
  ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, params.operationId),
          eq(agentInterventions.batchId, params.batchId),
          ownership(ctx),
        ),
      )
      .orderBy(asc(agentInterventions.itemIndex))
      .for('update');
    if (rows.length === 0) return { outcome: 'not_found' };

    const [resolution] = await tx
      .select()
      .from(agentInterventionResolutions)
      .where(and(eq(agentInterventionResolutions.id, resolutionId), resolutionOwnership(ctx)))
      .limit(1)
      .for('update');
    if (!resolution) return { outcome: 'not_found' };
    if (!isSameResolutionRequest(resolution, params)) {
      throw new Error(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED);
    }

    // A concurrent retry may already have reactivated or completed this exact
    // request. Return its current linked rows instead of applying effects twice.
    if (resolution.status !== 'rolled_back') {
      return {
        interventions: rows.filter((row) => row.resolutionId === resolution.id),
        outcome: 'idempotent',
        resolution,
      };
    }

    const now = new Date();
    if (
      rows.some(
        (row) =>
          ['pending', 'resolving', 'published'].includes(row.status) &&
          row.deadline.getTime() <= now.getTime(),
      )
    ) {
      const terminalRows = await markRowsTerminalInTransaction(ctx, tx, rows, 'timed_out', now);
      return { interventions: terminalRows, outcome: 'conflict', resolution };
    }

    const ids = rows.map((row) => row.id);
    const unchangedSnapshot =
      rows.length === params.expectedItemCount &&
      rows.every(
        (row, index) =>
          row.sealed &&
          row.itemCount === rows.length &&
          row.itemIndex === index &&
          params.expectedRequestRevisionHashes[row.id] === row.requestRevisionHash,
      ) &&
      hasExactKeys(params.expectedVersions, ids) &&
      hasExactKeys(params.expectedRequestRevisionHashes, ids);
    if (!unchangedSnapshot) return { interventions: rows, outcome: 'conflict', resolution };

    const selectedIds = uniqueSorted(params.selectedInterventionIds);
    const targets = rows.filter((row) => selectedIds.includes(row.id));
    if (
      !hasValidSelection(rows, targets, params, selectedIds) ||
      targets.some((row) => row.status !== 'pending' || row.resolutionId !== null)
    ) {
      return { interventions: rows, outcome: 'conflict', resolution };
    }
    validateAction(ctx, targets, params);

    const argumentEffect = await applyArgumentEffect(ctx, tx, targets, params.action);
    let rememberToolKey: null | string = null;
    let rememberEffectStatus: 'applied' | 'retained' | null = null;
    if (params.action.type === 'approve_remember') {
      const remember = await applyRememberEffect(ctx, tx, params.actorId, targets[0]);
      rememberToolKey = remember.toolKey;
      rememberEffectStatus = remember.status;
    }

    const [reactivatedResolution] = await tx
      .update(agentInterventionResolutions)
      .set({
        argumentEffectStatus: argumentEffect ? 'applied' : null,
        continuationStartedAt: null,
        editedArguments: argumentEffect?.editedArguments ?? null,
        editedRequestRevisionHash: argumentEffect?.editedRequestRevisionHash ?? null,
        originalArguments: argumentEffect?.originalArguments ?? null,
        originalRequestRevisionHash: argumentEffect?.originalRequestRevisionHash ?? null,
        producerAckAt: null,
        publishedAt: null,
        rememberEffectStatus,
        rememberToolKey,
        resolvingAt: now,
        rolledBackAt: null,
        status: 'resolving',
        terminalAt: null,
        updatedAt: now,
        version: sql`${agentInterventionResolutions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventionResolutions.id, resolution.id),
          eq(agentInterventionResolutions.status, 'rolled_back'),
        ),
      )
      .returning();
    if (!reactivatedResolution) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }

    const claimed = await tx
      .update(agentInterventions)
      .set({
        requestRevisionHash: argumentEffect?.editedRequestRevisionHash,
        resolutionId: resolution.id,
        resolvingAt: now,
        status: 'resolving',
        updatedAt: now,
        version: sql`${agentInterventions.version} + 1`,
      })
      .where(
        and(
          inArray(agentInterventions.id, selectedIds),
          ownership(ctx),
          eq(agentInterventions.status, 'pending'),
          isNull(agentInterventions.resolutionId),
          gt(agentInterventions.deadline, now),
        ),
      )
      .returning();
    if (claimed.length !== selectedIds.length) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }

    const updatedRows = rows.map((row) => claimed.find((item) => item.id === row.id) ?? row);
    return {
      interventions: updatedRows,
      outcome: 'applied',
      resolution: reactivatedResolution,
    };
  });
