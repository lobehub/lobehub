import type { AgentInterventionSanitizedRequest } from '@lobechat/types';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { type AgentInterventionItem, agentInterventions, agentOperations } from '../../schemas';
import type { Transaction } from '../../type';
import { isUniqueViolation } from '../../utils/uniqueViolation';
import {
  AGENT_INTERVENTION_IDENTITY_CONFLICT,
  AGENT_INTERVENTION_INVALID_ACTION,
  AGENT_INTERVENTION_INVALID_BATCH,
  AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH,
  AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH,
  HASH_PATTERN,
} from './constants';
import { type AgentInterventionContext, ownership } from './context';
import type {
  AgentInterventionOperationIdentity,
  CreateAgentInterventionBatchParams,
} from './types';
import {
  hasValidCustomDetail,
  isCanonicalDtoJsonSafe,
  normalizeDtoJson,
  sameDtoJson,
  sameJson,
  uniqueSorted,
} from './utils';

/** Creates and seals a complete batch in one transaction. */
export const createBatch = async (
  ctx: AgentInterventionContext,
  params: CreateAgentInterventionBatchParams,
): Promise<AgentInterventionItem[]> => {
  validateCreateBatch(params);
  return ctx.db.transaction((tx) => createBatchInTransaction(ctx, tx, params));
};

export const createBatchInTransaction = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  params: CreateAgentInterventionBatchParams,
  lockedOperationStatus?: AgentInterventionOperationIdentity['status'],
): Promise<AgentInterventionItem[]> => {
  let operationStatus = lockedOperationStatus;
  if (operationStatus === undefined) {
    const [ownedOperation] = await tx
      .select({ id: agentOperations.id, status: agentOperations.status })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, params.operationId),
          eq(agentOperations.userId, ctx.userId),
          ctx.workspaceId
            ? eq(agentOperations.workspaceId, ctx.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      )
      .limit(1)
      .for('update');
    if (!ownedOperation) throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    operationStatus = ownedOperation.status;
  }

  const existing = await tx
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

  if (existing.length > 0) {
    if (!isSameCreateBatch(existing, params)) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    }
    return existing;
  }
  if (params.source === 'runtime' && operationStatus !== 'waiting_for_human') {
    throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT);
  }

  try {
    return await tx
      .insert(agentInterventions)
      .values(
        params.items.map((item, itemIndex) => ({
          ...item,
          activityKey: params.activityKey,
          allowedActions: [...item.allowedActions],
          approvalMode: params.approvalMode ?? null,
          batchId: params.batchId,
          deadline: params.deadline,
          itemCount: params.items.length,
          itemIndex,
          operationId: params.operationId,
          provider: item.provider ?? params.provider ?? null,
          reviewContext: normalizeDtoJson(item.reviewContext),
          risk: item.risk === undefined ? null : normalizeDtoJson(item.risk),
          sanitizedRequest: normalizeDtoJson(item.sanitizedRequest),
          sealed: true,
          source: params.source,
          stepIndex: params.stepIndex,
          systemActionEligibility: params.systemActionEligibility,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? null,
        })),
      )
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(AGENT_INTERVENTION_IDENTITY_CONFLICT, { cause: error });
    }
    throw error;
  }
};

export const isSameCreateBatch = (
  existing: AgentInterventionItem[],
  params: CreateAgentInterventionBatchParams,
): boolean =>
  existing.length === params.items.length &&
  existing.every((row, index) => {
    const item = params.items[index];
    return (
      row.activityKey === params.activityKey &&
      row.approvalMode === (params.approvalMode ?? null) &&
      row.batchId === params.batchId &&
      row.canonicalToolKey === (item.canonicalToolKey ?? null) &&
      row.deadline.getTime() === params.deadline.getTime() &&
      row.interactionKind === item.interactionKind &&
      row.itemCount === params.items.length &&
      row.itemIndex === index &&
      row.provider === (item.provider ?? params.provider ?? null) &&
      row.requestRevisionHash === item.requestRevisionHash &&
      row.reviewTokenHash === item.reviewTokenHash &&
      row.sealed &&
      row.source === params.source &&
      row.stepIndex === params.stepIndex &&
      row.surface === item.surface &&
      row.systemActionEligibility === params.systemActionEligibility &&
      row.toolCallId === item.toolCallId &&
      row.toolMessageId === (item.toolMessageId ?? null) &&
      sameJson(uniqueSorted(row.allowedActions), uniqueSorted(item.allowedActions)) &&
      sameDtoJson(row.reviewContext, item.reviewContext) &&
      sameDtoJson(row.risk, item.risk ?? null) &&
      sameDtoJson(row.sanitizedRequest, item.sanitizedRequest)
    );
  });

export function validateCreateBatch(params: CreateAgentInterventionBatchParams) {
  if (!params.batchId || !params.activityKey || params.items.length === 0 || params.stepIndex < 0) {
    throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
  }
  if (
    params.systemActionEligibility === 'safe_single_binary' &&
    (params.items.length !== 1 ||
      params.source !== 'runtime' ||
      params.items[0].surface !== 'binary')
  ) {
    throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
  }
  const toolCallIds = new Set<string>();
  const reviewHashes = new Set<string>();
  for (const item of params.items) {
    if (!HASH_PATTERN.test(item.reviewTokenHash)) {
      throw new Error(AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH);
    }
    if (!HASH_PATTERN.test(item.requestRevisionHash)) {
      throw new Error(AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH);
    }
    if (
      !item.toolCallId ||
      item.allowedActions.length === 0 ||
      uniqueSorted(item.allowedActions).length !== item.allowedActions.length ||
      toolCallIds.has(item.toolCallId) ||
      reviewHashes.has(item.reviewTokenHash)
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }
    const unsafeRequest = item.sanitizedRequest as AgentInterventionSanitizedRequest &
      Record<string, unknown>;
    if (
      !isCanonicalDtoJsonSafe(item.reviewContext) ||
      !isCanonicalDtoJsonSafe(item.risk ?? null) ||
      !isCanonicalDtoJsonSafe(item.sanitizedRequest) ||
      'arguments' in unsafeRequest ||
      'rawArguments' in unsafeRequest ||
      'metadata' in unsafeRequest ||
      !hasValidCustomDetail(item.sanitizedRequest)
    ) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }
    const hasQuestionFreeform =
      item.sanitizedRequest.answerPolicy?.allowFreeform === true ||
      item.sanitizedRequest.answerPolicy?.allowSupplement === true ||
      item.sanitizedRequest.questions?.some((question) => question.allowCustomAnswer) === true;
    if (hasQuestionFreeform && item.interactionKind !== 'question') {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (item.allowedActions.includes('approve_remember') && !item.canonicalToolKey) {
      throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
    }
    if (params.source === 'heterogeneous' && !(item.provider ?? params.provider)) {
      throw new Error(AGENT_INTERVENTION_INVALID_BATCH);
    }
    toolCallIds.add(item.toolCallId);
    reviewHashes.add(item.reviewTokenHash);
  }
}
