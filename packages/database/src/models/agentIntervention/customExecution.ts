import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { agentInterventionResolutions } from '../../schemas';
import {
  AGENT_INTERVENTION_CUSTOM_EXECUTION_MAX_LEASE_MS,
  AGENT_INTERVENTION_CUSTOM_EXECUTION_MIN_LEASE_MS,
  HASH_PATTERN,
  UUID_PATTERN,
} from './constants';
import { type AgentInterventionContext, resolutionOwnership } from './context';
import type {
  AgentInterventionCustomExecutionClaimResult,
  AgentInterventionCustomExecutionCompletionResult,
  ClaimAgentInterventionCustomExecutionParams,
  CompleteAgentInterventionCustomExecutionParams,
} from './types';
import { isCustomExecutionResult, sameJson } from './utils';

/**
 * Atomically claims a short custom-execution lease without holding a database
 * transaction across the external side effect. A completed claim replays the
 * exact durable private result; a live lease never exposes its fencing token.
 */
export const claimCustomExecution = async (
  ctx: AgentInterventionContext,
  params: ClaimAgentInterventionCustomExecutionParams,
  now = new Date(),
): Promise<AgentInterventionCustomExecutionClaimResult> => {
  if (
    !UUID_PATTERN.test(params.resolutionRequestId) ||
    !HASH_PATTERN.test(params.inputHash) ||
    !Number.isSafeInteger(params.leaseDurationMs) ||
    params.leaseDurationMs < AGENT_INTERVENTION_CUSTOM_EXECUTION_MIN_LEASE_MS ||
    params.leaseDurationMs > AGENT_INTERVENTION_CUSTOM_EXECUTION_MAX_LEASE_MS ||
    Number.isNaN(now.getTime())
  ) {
    return { outcome: 'conflict' };
  }

  return ctx.db.transaction(async (tx) => {
    const [resolution] = await tx
      .select()
      .from(agentInterventionResolutions)
      .where(
        and(
          eq(agentInterventionResolutions.resolutionRequestId, params.resolutionRequestId),
          resolutionOwnership(ctx),
        ),
      )
      .limit(1)
      .for('update');
    if (!resolution || resolution.action.type !== 'submit_custom') {
      return { outcome: 'conflict' };
    }
    if (
      resolution.customExecutionInputHash &&
      resolution.customExecutionInputHash !== params.inputHash
    ) {
      return { outcome: 'conflict' };
    }

    if (resolution.customExecutionState === 'completed') {
      return resolution.customExecutionResult
        ? { outcome: 'completed', result: resolution.customExecutionResult }
        : { outcome: 'conflict' };
    }
    if (resolution.status !== 'resolving') {
      return { outcome: 'conflict' };
    }

    if (resolution.customExecutionState === 'executing') {
      /* v8 ignore if -- unreachable: the custom_execution_state CHECK requires an executing row to carry a lease token, a lease expiry and an attempt > 0 */
      if (
        !resolution.customExecutionLeaseToken ||
        !resolution.customExecutionLeaseExpiresAt ||
        resolution.customExecutionAttempt === null
      ) {
        return { outcome: 'conflict' };
      }
      if (resolution.customExecutionLeaseExpiresAt.getTime() > now.getTime()) {
        return {
          attempt: resolution.customExecutionAttempt,
          leaseExpiresAt: resolution.customExecutionLeaseExpiresAt,
          outcome: 'in_progress',
        };
      }
      /* v8 ignore start -- unreachable: the custom_execution_state CHECK only admits NULL, pending, executing and completed, and executing/completed are handled above */
    } else if (
      resolution.customExecutionState !== 'pending' &&
      resolution.customExecutionState !== null
    ) {
      return { outcome: 'conflict' };
    }
    /* v8 ignore stop */

    const attempt = (resolution.customExecutionAttempt ?? 0) + 1;
    const leaseExpiresAt = new Date(now.getTime() + params.leaseDurationMs);
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(agentInterventionResolutions)
      .set({
        customExecutionAttempt: attempt,
        customExecutionInputHash: params.inputHash,
        customExecutionLeaseExpiresAt: leaseExpiresAt,
        customExecutionLeaseToken: leaseToken,
        customExecutionResult: null,
        customExecutionState: 'executing',
        updatedAt: now,
        version: sql`${agentInterventionResolutions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventionResolutions.id, resolution.id),
          resolutionOwnership(ctx),
          eq(agentInterventionResolutions.status, 'resolving'),
        ),
      )
      .returning({ id: agentInterventionResolutions.id });
    return claimed
      ? { attempt, leaseExpiresAt, leaseToken, outcome: 'applied' }
      : /* v8 ignore next -- unreachable: the row was locked FOR UPDATE in this transaction with the same ownership and was just checked to be resolving, so the UPDATE by its id always returns it */ {
          outcome: 'conflict',
        };
  });
};

/** Completes only the exact current fencing token and replays exact retries. */
export const completeCustomExecution = async (
  ctx: AgentInterventionContext,
  params: CompleteAgentInterventionCustomExecutionParams,
  now = new Date(),
): Promise<AgentInterventionCustomExecutionCompletionResult> => {
  if (
    !UUID_PATTERN.test(params.resolutionRequestId) ||
    !HASH_PATTERN.test(params.inputHash) ||
    !UUID_PATTERN.test(params.leaseToken) ||
    !isCustomExecutionResult(params.result) ||
    Number.isNaN(now.getTime())
  ) {
    return { outcome: 'conflict' };
  }

  return ctx.db.transaction(async (tx) => {
    const [resolution] = await tx
      .select()
      .from(agentInterventionResolutions)
      .where(
        and(
          eq(agentInterventionResolutions.resolutionRequestId, params.resolutionRequestId),
          resolutionOwnership(ctx),
        ),
      )
      .limit(1)
      .for('update');
    if (
      !resolution ||
      resolution.action.type !== 'submit_custom' ||
      resolution.customExecutionInputHash !== params.inputHash ||
      resolution.customExecutionLeaseToken !== params.leaseToken
    ) {
      return { outcome: 'conflict' };
    }

    if (resolution.customExecutionState === 'completed') {
      return resolution.customExecutionResult &&
        sameJson(resolution.customExecutionResult, params.result)
        ? { outcome: 'completed', result: resolution.customExecutionResult }
        : { outcome: 'conflict' };
    }
    if (resolution.status !== 'resolving' || resolution.customExecutionState !== 'executing') {
      return { outcome: 'conflict' };
    }

    const [completed] = await tx
      .update(agentInterventionResolutions)
      .set({
        customExecutionResult: params.result,
        customExecutionState: 'completed',
        updatedAt: now,
        version: sql`${agentInterventionResolutions.version} + 1`,
      })
      .where(
        and(
          eq(agentInterventionResolutions.id, resolution.id),
          resolutionOwnership(ctx),
          eq(agentInterventionResolutions.customExecutionInputHash, params.inputHash),
          eq(agentInterventionResolutions.customExecutionLeaseToken, params.leaseToken),
          eq(agentInterventionResolutions.customExecutionState, 'executing'),
          eq(agentInterventionResolutions.status, 'resolving'),
        ),
      )
      .returning({ result: agentInterventionResolutions.customExecutionResult });
    return completed?.result
      ? { outcome: 'completed', result: completed.result }
      : /* v8 ignore next -- unreachable: the row was locked FOR UPDATE in this transaction and just matched every filter of this UPDATE, which writes the validated non-null result */ {
          outcome: 'conflict',
        };
  });
};
