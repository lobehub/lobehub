import type { AgentSignalSource, RuntimeProcessorResult } from '@lobechat/agent-signal';
import { createSignal } from '@lobechat/agent-signal';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { AGENT_SIGNAL_POLICY_SIGNAL_TYPES } from '../policies/types';
import type { RuntimeProcessorContext } from '../runtime/context';
import { defineSourceHandler } from '../runtime/middleware';
import type { SelfReflectionService } from '../services/selfReflection';
import type {
  AsyncSelfReflectionAccumulator,
  SelfReflectionAccumulatorDecision,
  SelfReflectionAccumulatorEventType,
} from './accumulators/selfReflection';
import { createProcedureKey, getCoarseProcedureDomain } from './keys';
import { createProcedureMarker } from './marker';
import { createProcedureRecord } from './record';
import type {
  AgentSignalProcedureMarker,
  AgentSignalProcedureReceipt,
  AgentSignalProcedureRecord,
} from './types';

/**
 * Stable self-reflection weak-signal window coordinates for one tool outcome.
 */
export interface ToolOutcomeSelfReflectionWindowInput {
  /** Accumulator decision that crossed a self-reflection threshold. */
  decision: SelfReflectionAccumulatorDecision;
  /** Normalized source being handled by the tool-outcome procedure handler. */
  source: AgentSignalSource;
}

/**
 * Optional self-reflection dependencies for tool outcome weak-signal wiring.
 */
export interface ToolOutcomeSelfReflectionDeps {
  /** Records weak tool-outcome signals across a caller-owned lifecycle. */
  accumulator: AsyncSelfReflectionAccumulator;
  /** Provides the stable beginning of the accumulated weak-signal window. */
  getWindowStart: (input: ToolOutcomeSelfReflectionWindowInput) => string;
  /** Emits self-reflection requests when an accumulator threshold crosses. */
  service: SelfReflectionService;
  /** Stable workflow user id used when the source renderer does not carry a hydrated scope. */
  userId: string;
}

/**
 * Storage dependencies for the tool outcome procedure source handler.
 */
export interface ToolOutcomeProcedureDeps {
  /** Appends a record into domain accumulation state. */
  accumulator: { appendRecord: (record: AgentSignalProcedureRecord) => Promise<void> };
  /** Writes handled markers after record persistence succeeds. */
  markerStore: { write: (marker: AgentSignalProcedureMarker) => Promise<void> };
  /** Provides a consistent millisecond timestamp for procedure writes. */
  now: () => number;
  /** Appends context receipts for compact continuity. */
  receiptStore: { append: (receipt: AgentSignalProcedureReceipt) => Promise<void> };
  /** Writes the compact procedure record. */
  recordStore: { write: (record: AgentSignalProcedureRecord) => Promise<void> };
  /** Optional self-reflection service wiring owned by a stable runtime lifecycle. */
  selfReflection?: ToolOutcomeSelfReflectionDeps;
  /** TTL used for marker expiration and policy-state writes. */
  ttlSeconds: number;
}

const TOOL_OUTCOME_SOURCE_TYPES = [
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
] as const;

interface ToolOutcomePayload {
  agentId?: string;
  domainKey?: string;
  intentClass?: string;
  messageId?: string;
  operationId?: string;
  outcome?: { status?: string; summary?: string };
  relatedObjects?: AgentSignalProcedureRecord['relatedObjects'];
  taskId?: string;
  tool?: { apiName?: string; identifier?: string };
  toolCallId?: string;
  topicId?: string;
}

const shouldWriteHandledMarker = (input: {
  domainKey: string;
  intentClass?: string;
  status: string;
}) => {
  if (input.status !== 'succeeded' && input.status !== 'skipped') return false;

  const domain = getCoarseProcedureDomain(input.domainKey);
  if (domain === 'memory') {
    return input.intentClass === 'explicit_persistence';
  }
  if (domain === 'skill') {
    return input.intentClass === 'tool_command' || input.intentClass === 'explicit_persistence';
  }

  return false;
};

const resolveSelfReflectionEventType = (status: string): SelfReflectionAccumulatorEventType => {
  return status === 'failed' ? 'tool_failed' : 'tool_completed';
};

const resolveToolName = (payload: ToolOutcomePayload) =>
  payload.tool?.apiName ?? payload.tool?.identifier;

/**
 * Normalizes a millisecond timestamp into an ISO string only when Date can represent it.
 *
 * Before:
 * - 4000
 * - Number.NaN
 *
 * After:
 * - "1970-01-01T00:00:04.000Z"
 * - undefined
 */
const toSafeIsoTimestamp = (timestamp: number): string | undefined => {
  if (!Number.isFinite(timestamp)) return;

  try {
    return new Date(timestamp).toISOString();
  } catch {
    return;
  }
};

/**
 * Resolves self-reflection window end from source time, then the procedure write clock.
 *
 * Before:
 * - sourceTimestamp: Number.NaN, fallbackTimestamp: 4000
 *
 * After:
 * - "1970-01-01T00:00:04.000Z"
 */
const resolveSelfReflectionWindowEnd = (input: {
  fallbackTimestamp: number;
  sourceTimestamp: number;
}) => {
  return toSafeIsoTimestamp(input.sourceTimestamp) ?? toSafeIsoTimestamp(input.fallbackTimestamp);
};

const handleSelfReflectionToolOutcome = async (input: {
  deps: ToolOutcomeProcedureDeps;
  fallbackTimestamp: number;
  payload: ToolOutcomePayload;
  source: AgentSignalSource;
}) => {
  try {
    const { selfReflection } = input.deps;
    if (!selfReflection) return;

    const userId = input.source.scope?.userId ?? selfReflection.userId;
    const agentId = input.payload.agentId ?? input.source.scope?.agentId;
    const status = input.payload.outcome?.status;
    if (!userId || !agentId || !status) return;

    const windowEnd = resolveSelfReflectionWindowEnd({
      fallbackTimestamp: input.fallbackTimestamp,
      sourceTimestamp: input.source.timestamp,
    });
    if (!windowEnd) return;

    const decision = await selfReflection.accumulator.record({
      agentId,
      eventType: resolveSelfReflectionEventType(status),
      eventTimestamp: windowEnd,
      operationId: input.payload.operationId,
      sourceId: input.source.sourceId,
      taskId: input.payload.taskId ?? input.source.scope?.taskId,
      toolName: resolveToolName(input.payload),
      topicId: input.payload.topicId ?? input.source.scope?.topicId,
      userId,
    });

    if (!decision.shouldRequest || !decision.reason || !decision.scopeId || !decision.scopeType) {
      return;
    }

    void selfReflection.service
      .requestSelfReflection({
        agentId,
        operationId: input.payload.operationId,
        reason: decision.reason,
        scopeId: decision.scopeId,
        scopeType: decision.scopeType,
        taskId: input.payload.taskId ?? input.source.scope?.taskId,
        topicId: input.payload.topicId ?? input.source.scope?.topicId,
        userId,
        windowEnd,
        windowStart: selfReflection.getWindowStart({ decision, source: input.source }),
      })
      .catch((error) => {
        console.error('[AgentSignal] Failed to request self-reflection:', error);
      });
  } catch (error) {
    console.error('[AgentSignal] Failed to request self-reflection:', error);
  }
};

/**
 * Creates the source handler that normalizes direct tool outcomes into procedure projections.
 *
 * Use when:
 * - Direct memory, skill, or document tools emit generic outcome sources
 * - Same-turn suppression needs the synchronous procedure projection to already exist
 *
 * Expects:
 * - Dependencies write records before markers
 * - Source payloads use `tool.outcome.completed` or `tool.outcome.failed`
 *
 * Returns:
 * - Source handler that dispatches a `signal.tool.outcome` signal
 *
 * Triggering workflow:
 *
 * {@link defineSourceHandler}
 *   -> `source.tool-outcome.procedure`
 *     -> `tool.outcome.completed` / `tool.outcome.failed`
 *       -> {@link createToolOutcomeSourceHandler}
 *
 * Upstream:
 * - {@link defineSourceHandler}
 *
 * Downstream:
 * - {@link createProcedureRecord}
 * - {@link SelfReflectionService.requestSelfReflection}
 */
export const createToolOutcomeSourceHandler = (deps: ToolOutcomeProcedureDeps) =>
  defineSourceHandler(
    TOOL_OUTCOME_SOURCE_TYPES,
    'source.tool-outcome.procedure',
    async (
      source: AgentSignalSource,
      context: RuntimeProcessorContext,
    ): Promise<RuntimeProcessorResult | void> => {
      const payload = source.payload as ToolOutcomePayload;
      if (!payload.domainKey || !payload.outcome?.status) return;

      const signal = createSignal({
        payload: source.payload,
        signalId: `${source.sourceId}:signal:tool-outcome`,
        signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.toolOutcome,
        source,
        timestamp: source.timestamp,
      });
      const now = deps.now();
      const record = createProcedureRecord({
        accumulatorRole: 'context',
        cheapScoreDelta: 0,
        createdAt: now,
        domainKey: payload.domainKey,
        id: `procedure-record:${source.sourceId}`,
        intentClass: payload.intentClass,
        refs: { signalIds: [signal.signalId], sourceIds: [source.sourceId] },
        relatedObjects: payload.relatedObjects,
        scopeKey: context.scopeKey,
        status: payload.outcome.status === 'failed' ? 'failed' : 'handled',
        summary: payload.outcome.summary,
      });

      await deps.recordStore.write(record);
      await deps.accumulator.appendRecord(record);

      const procedureKey = createProcedureKey({
        messageId: payload.messageId,
        operationId: payload.operationId,
        rootSourceId: source.chain.rootSourceId,
        toolCallId: payload.toolCallId,
      });

      await deps.receiptStore.append({
        createdAt: now,
        domainKey: payload.domainKey,
        id: `procedure-receipt:${record.id}`,
        intentClass: payload.intentClass,
        messageId: payload.messageId,
        recordIds: [record.id],
        relatedObjects: payload.relatedObjects,
        scopeKey: context.scopeKey,
        sourceId: source.sourceId,
        status: payload.outcome.status === 'failed' ? 'failed' : 'handled',
        summary: payload.outcome.summary ?? `${payload.domainKey} tool outcome handled.`,
        updatedAt: now,
      });

      await handleSelfReflectionToolOutcome({ deps, fallbackTimestamp: now, payload, source });

      if (
        shouldWriteHandledMarker({
          domainKey: payload.domainKey,
          intentClass: payload.intentClass,
          status: payload.outcome.status,
        })
      ) {
        await deps.markerStore.write(
          createProcedureMarker({
            createdAt: now,
            domainKey: payload.domainKey,
            expiresAt: now + deps.ttlSeconds * 1000,
            intentClass: payload.intentClass,
            markerType: 'handled',
            procedureKey,
            recordId: record.id,
            scopeKey: context.scopeKey,
            signalId: signal.signalId,
            sourceId: source.sourceId,
          }),
        );
      }

      return { signals: [signal], status: 'dispatch' };
    },
  );
