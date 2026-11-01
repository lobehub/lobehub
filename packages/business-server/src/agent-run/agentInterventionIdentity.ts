import { createHash } from 'node:crypto';

const AGENT_INTERVENTION_ACTIVITY_KEY_DOMAIN = 'lobehub:agent-intervention:activity-key:v2';
const AGENT_INTERVENTION_CONTINUATION_OPERATION_DOMAIN =
  'lobehub:agent-intervention:continuation-operation:v1';

export interface AgentInterventionContinuationProvenance {
  resolutionRequestId: string;
  sourceOperationId: string;
  sourceToolMessageIds: string[];
}

/** Compare JSONB provenance by fields, never by object key insertion order. */
export const matchesAgentInterventionContinuationProvenance = (
  actual: unknown,
  expected: AgentInterventionContinuationProvenance,
): boolean => {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const candidate = actual as Partial<AgentInterventionContinuationProvenance>;
  const candidateKeys = Object.keys(candidate).sort();
  if (
    candidateKeys.length !== 3 ||
    candidateKeys[0] !== 'resolutionRequestId' ||
    candidateKeys[1] !== 'sourceOperationId' ||
    candidateKeys[2] !== 'sourceToolMessageIds'
  ) {
    return false;
  }
  if (
    candidate.resolutionRequestId !== expected.resolutionRequestId ||
    candidate.sourceOperationId !== expected.sourceOperationId ||
    !Array.isArray(candidate.sourceToolMessageIds) ||
    !candidate.sourceToolMessageIds.every((id) => typeof id === 'string') ||
    candidate.sourceToolMessageIds.length !== expected.sourceToolMessageIds.length
  ) {
    return false;
  }

  const actualIds = [...candidate.sourceToolMessageIds].sort();
  const expectedIds = [...expected.sourceToolMessageIds].sort();
  return actualIds.every((id, index) => id === expectedIds[index]);
};

/** Canonical edit/claim CAS hash. The raw JSON string is intentionally not normalized. */
export const hashAgentInterventionRequestRevision = (rawArguments: string): string =>
  createHash('sha256').update(rawArguments).digest('hex');

/**
 * Stable operation id for one durable resolution request. A retry after the
 * source message claim can therefore prove whether the exact continuation was
 * durably created instead of treating the pre-dispatch message patch itself as
 * execution evidence.
 */
export const deriveAgentInterventionContinuationOperationId = (params: {
  resolutionRequestId: string;
  userId: string;
  workspaceId?: string | null;
}): string =>
  `op_intervention_${createHash('sha256')
    .update(
      JSON.stringify([
        AGENT_INTERVENTION_CONTINUATION_OPERATION_DOMAIN,
        params.userId,
        params.workspaceId ?? null,
        params.resolutionRequestId,
      ]),
    )
    .digest('hex')
    .slice(0, 32)}`;

/** Stable assistant placeholder paired with the continuation operation above. */
export const deriveAgentInterventionContinuationMessageId = (
  params: Parameters<typeof deriveAgentInterventionContinuationOperationId>[0],
): string =>
  `msg_intervention_${createHash('sha256')
    .update(
      JSON.stringify([
        `${AGENT_INTERVENTION_CONTINUATION_OPERATION_DOMAIN}:assistant-message`,
        params.userId,
        params.workspaceId ?? null,
        params.resolutionRequestId,
      ]),
    )
    .digest('hex')
    .slice(0, 32)}`;

/** Stable QStash/local-queue execute-once key for the continuation's first step. */
export const deriveAgentInterventionQueueDeduplicationId = (
  operationId: string,
  stepIndex: number,
): string => `agent-intervention:${operationId}:${stepIndex}`;

/**
 * Deterministic RFC-4122-shaped activity correlation for a sealed batch.
 * Tenant, owner, operation and batch are all domain-separated; idempotent
 * producer delivery therefore reuses one Live Activity without exposing the
 * producer's compound batch id.
 */
export const deriveAgentInterventionActivityKey = (params: {
  batchId: string;
  operationId: string;
  userId: string;
  workspaceId?: string;
}): string => {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        AGENT_INTERVENTION_ACTIVITY_KEY_DOMAIN,
        params.userId,
        params.workspaceId ?? null,
        params.operationId,
        params.batchId,
      ]),
    )
    .digest('hex')
    .slice(0, 32)
    .split('');

  digest[12] = '5';
  digest[16] = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  const value = digest.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
