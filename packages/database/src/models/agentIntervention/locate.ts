import { and, eq, sql } from 'drizzle-orm';

import { agentInterventionResolutions, agentInterventions } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { HASH_PATTERN, UUID_PATTERN } from './constants';
import type { AgentInterventionLocator, AgentInterventionResolutionLocator } from './types';

/**
 * System-only locator. It returns only routing/ACL context and never exposes
 * render content, action capability, token hash, or resolution payload.
 */
export const locateByReviewTokenHash = async (
  db: LobeChatDatabase,
  reviewTokenHash: string,
): Promise<AgentInterventionLocator | undefined> => {
  if (!HASH_PATTERN.test(reviewTokenHash)) return undefined;

  const [row] = await db
    .select({
      activityKey: agentInterventions.activityKey,
      batchId: agentInterventions.batchId,
      deadline: agentInterventions.deadline,
      id: agentInterventions.id,
      operationId: agentInterventions.operationId,
      source: agentInterventions.source,
      status: agentInterventions.status,
      userId: agentInterventions.userId,
      workspaceId: agentInterventions.workspaceId,
    })
    .from(agentInterventions)
    .where(eq(agentInterventions.reviewTokenHash, reviewTokenHash))
    .limit(1);

  return row;
};

/**
 * System-only compatibility locator for authenticated in-conversation
 * actions. The correlation pair is not authority: callers must still load
 * the owning operation, apply resource ACL, and then rebuild the
 * owner/workspace-scoped model before reading or claiming the batch.
 *
 * Use when:
 * - Resolving an authenticated callback without a review token.
 *
 * Expects:
 * - Batch or callback identity when an operation/tool pair has multiple rows.
 *
 * Returns:
 * - The exact locator, undefined if absent, or an error for ambiguous legacy input.
 * - Never substitutes a newer pending batch for an older client action.
 */
export const locateByOperationAndToolCall = async (
  db: LobeChatDatabase,
  operationId: string,
  toolCallId: string,
  callback?: { batchId?: string; interventionId?: string },
): Promise<AgentInterventionLocator | undefined> => {
  if (!operationId.trim() || !toolCallId.trim()) return undefined;

  const rows = await db
    .select({
      activityKey: agentInterventions.activityKey,
      batchId: agentInterventions.batchId,
      deadline: agentInterventions.deadline,
      id: agentInterventions.id,
      operationId: agentInterventions.operationId,
      source: agentInterventions.source,
      status: agentInterventions.status,
      userId: agentInterventions.userId,
      workspaceId: agentInterventions.workspaceId,
    })
    .from(agentInterventions)
    .where(
      and(
        eq(agentInterventions.operationId, operationId),
        eq(agentInterventions.toolCallId, toolCallId),
        callback?.batchId ? eq(agentInterventions.batchId, callback.batchId) : undefined,
        callback?.interventionId
          ? sql`${agentInterventions.sanitizedRequest}->>'interventionId' = ${callback.interventionId}`
          : undefined,
      ),
    )
    .limit(2);

  if (rows.length > 1)
    throw new Error('Ambiguous intervention callback; batch or callback identity is required');
  return rows[0];
};

/** System-only owner/workspace recovery for post-claim delivery callbacks. */
export const locateByResolutionRequestId = async (
  db: LobeChatDatabase,
  resolutionRequestId: string,
): Promise<AgentInterventionResolutionLocator | undefined> => {
  if (!UUID_PATTERN.test(resolutionRequestId)) return undefined;
  const [row] = await db
    .select({
      batchId: agentInterventionResolutions.batchId,
      operationId: agentInterventionResolutions.operationId,
      source: agentInterventionResolutions.source,
      userId: agentInterventionResolutions.userId,
      workspaceId: agentInterventionResolutions.workspaceId,
    })
    .from(agentInterventionResolutions)
    .where(eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId))
    .limit(1);
  return row;
};
