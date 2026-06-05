import type { VentCategory, VentParams, VentSeverity } from '@lobechat/builtin-tool-lobe-agent';
import { VENT_CATEGORIES, VENT_SEVERITIES } from '@lobechat/builtin-tool-lobe-agent';

/** Input used by the vent service to record one report. */
export interface VentRecordInput {
  /** Stable agent id associated with the running agent. */
  agentId: string;
  /** Agent-declared vent payload. */
  input: VentParams;
  /** Runtime operation id when the vent is operation-scoped. */
  operationId?: string;
  /** Caller-provided tool-call id. */
  toolCallId?: string;
  /** Topic the vent belongs to. */
  topicId: string;
  /** Stable user id associated with the running agent. */
  userId: string;
}

export type VentRecordRejection = 'invalid_category' | 'invalid_severity' | 'rate_limited';

/** Result returned after one vent attempt. */
export interface VentResult {
  /** Optional rejection reason when nothing was recorded. */
  reason?: VentRecordRejection;
  /** Whether the vent was recorded. */
  recorded: boolean;
  /** Stable vent id built for recorded reports when available. */
  ventId?: string;
}

/** Vent recording service API consumed by the LobeAgent server runtime. */
export interface VentRuntimeService {
  recordVent: (input: VentRecordInput) => Promise<VentResult>;
}

/** Dependencies used by the pure vent recording service. */
export interface VentServiceDependencies {
  /** Creates a stable tool-call id when the caller did not provide one. */
  nextToolCallId: () => string;
}

/** At most this many vents per operation scope; a topic-scoped fallback gets a looser cap. */
const VENT_LIMIT_PER_OPERATION = 1;
const VENT_LIMIT_PER_TOPIC = 3;

const validCategories = new Set<VentCategory>(VENT_CATEGORIES);
const validSeverities = new Set<VentSeverity>(VENT_SEVERITIES);

const getScope = (input: VentRecordInput) =>
  input.operationId
    ? ({ id: input.operationId, key: `operation:${input.operationId}`, type: 'operation' } as const)
    : ({ id: input.topicId, key: `topic:${input.topicId}`, type: 'topic' } as const);

const buildVentId = (params: {
  agentId: string;
  scopeId: string;
  scopeType: string;
  toolCallId: string;
  userId: string;
}) =>
  `vent:${params.userId}:${params.agentId}:${params.scopeType}:${params.scopeId}:${params.toolCallId}`;

/**
 * Creates a pure vent recording service.
 *
 * Use when:
 * - The LobeAgent server runtime needs a DI-friendly vent boundary
 * - Tests need deterministic tool-call ids and rate-limit state
 *
 * Expects:
 * - The durable record is the persisted vent tool-call message itself
 * - The service instance owns only in-memory fast-loop rate limiting
 *
 * Returns:
 * - A service that accepts valid vents and never mutates user-facing resources
 */
export const createVentService = (deps: VentServiceDependencies): VentRuntimeService => {
  const recordedCounts = new Map<string, number>();

  return {
    recordVent: async (input): Promise<VentResult> => {
      if (!validCategories.has(input.input.category)) {
        return { recorded: false, reason: 'invalid_category' };
      }

      if (!validSeverities.has(input.input.severity)) {
        return { recorded: false, reason: 'invalid_severity' };
      }

      const scope = getScope(input);
      const limit = scope.type === 'operation' ? VENT_LIMIT_PER_OPERATION : VENT_LIMIT_PER_TOPIC;
      const rateLimitKey = `${input.userId}:${input.agentId}:${scope.key}`;
      const recordedCount = recordedCounts.get(rateLimitKey) ?? 0;

      if (recordedCount >= limit) {
        return { recorded: false, reason: 'rate_limited' };
      }

      const toolCallId = input.toolCallId ?? deps.nextToolCallId();
      const ventId = buildVentId({
        agentId: input.agentId,
        scopeId: scope.id,
        scopeType: scope.type,
        toolCallId,
        userId: input.userId,
      });

      recordedCounts.set(rateLimitKey, recordedCount + 1);

      return { recorded: true, ventId };
    },
  };
};
