import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import type { AgentSignalExecutionContext } from '../emitter';
import { enqueueAgentSignalSourceEvent } from '../emitter';
import type { AgentSignalPolicyStateStore } from '../store/types';
import { appendProcedureAccumulatorRecord } from './accumulator';
import { createProcedureKey } from './keys';
import { createProcedureMarker, writeProcedureMarker } from './marker';
import { appendProcedureReceipt } from './receipt';
import { createProcedureRecord, writeProcedureRecordField } from './record';

/**
 * Direct tool outcome emission input.
 */
export interface EmitToolOutcomeInput {
  /** Tool API method name. */
  apiName?: string;
  /** Agent Signal execution context used by async source enqueue. */
  context: Pick<AgentSignalExecutionContext, 'agentId' | 'userId'>;
  /** Fine-grained procedure domain key. */
  domainKey?: string;
  /** Compact failure reason for failed outcomes. */
  errorReason?: string;
  /** Tool identifier. */
  identifier: string;
  /** Intent class associated with the direct tool outcome. */
  intentClass?: string;
  /** Message id when known. */
  messageId?: string;
  /** Operation id when known. */
  operationId?: string;
  /** Related domain objects changed or observed by the tool. */
  relatedObjects?: Array<{ objectId: string; objectType: string; relation?: string }>;
  /** Runtime scope fields used to match planner suppression. */
  scope: {
    agentId?: string;
    botScopeKey?: string;
    taskId?: string;
    topicId?: string;
    userId: string;
  };
  /** Resolved runtime scope key. */
  scopeKey: string;
  /** Tool outcome status. */
  status: 'failed' | 'skipped' | 'succeeded';
  /** Compact outcome summary. */
  summary?: string;
  /** Tool action such as create, update, import, or activate. */
  toolAction?: string;
  /** Tool call id when known. */
  toolCallId?: string;
}

/**
 * Creates a stable source id for one direct tool outcome.
 *
 * Use when:
 * - Direct tool execution writes procedure state before async enqueue
 * - Idempotent source identity should prefer the per-call tool id before broader operation ids
 *
 * Expects:
 * - Natural-language text is not used for identity
 *
 * Returns:
 * - Stable tool outcome source id
 */
export const createToolOutcomeSourceId = (input: EmitToolOutcomeInput) => {
  const stableId =
    input.toolCallId ??
    input.operationId ??
    input.messageId ??
    `${input.scopeKey}:${input.identifier}:${input.apiName ?? 'unknown'}:${input.toolAction ?? 'unknown'}`;

  return `tool-outcome:${input.identifier}:${input.apiName ?? 'unknown'}:${input.status}:${stableId}`;
};

/**
 * Resolves direct tool outcome scope from request context fields.
 *
 * Use when:
 * - Tool runtimes need the same scope priority as planner suppression
 * - Topic or task context should win over broader agent/user fallback
 *
 * Expects:
 * - `userId` is always present
 *
 * Returns:
 * - Scope object and scope key using topic, task, agent+user, then user fallback
 */
export const resolveToolOutcomeScope = (input: {
  agentId?: string;
  taskId?: string;
  topicId?: string;
  userId: string;
}) => {
  const scope = {
    agentId: input.agentId,
    taskId: input.taskId,
    topicId: input.topicId,
    userId: input.userId,
  };
  const scopeKey = input.topicId
    ? `topic:${input.topicId}`
    : input.taskId
      ? `task:${input.taskId}`
      : input.agentId
        ? `agent:${input.agentId}:user:${input.userId}`
        : `user:${input.userId}`;

  return { scope, scopeKey };
};

const shouldWriteDirectHandledMarker = (input: EmitToolOutcomeInput) => {
  if (input.status !== 'succeeded' && input.status !== 'skipped') return false;
  if (input.domainKey?.startsWith('memory:')) return input.intentClass === 'explicit_persistence';
  if (input.domainKey?.startsWith('skill:')) {
    return input.intentClass === 'tool_command' || input.intentClass === 'explicit_persistence';
  }

  return false;
};

/**
 * Records a direct tool outcome as synchronous procedure policy state.
 *
 * Use when:
 * - Tool execution needs to leave a same-turn causal fact
 * - Planner suppression must read marker state before async workflow processing
 *
 * Expects:
 * - `scopeKey` matches the later planner runtime scope
 * - Caller provides structured ids rather than text-derived identity
 *
 * Returns:
 * - Source id used by the corresponding async tool outcome event
 */
export const recordToolOutcome = async (
  input: EmitToolOutcomeInput & {
    policyStateStore: AgentSignalPolicyStateStore;
    ttlSeconds: number;
  },
) => {
  const sourceId = createToolOutcomeSourceId(input);
  const procedureKey = createProcedureKey({
    messageId: input.messageId,
    operationId: input.operationId,
    rootSourceId: sourceId,
    toolCallId: input.toolCallId,
  });
  const now = Date.now();

  if (input.domainKey) {
    const record = createProcedureRecord({
      accumulatorRole: 'context',
      cheapScoreDelta: 0,
      createdAt: now,
      domainKey: input.domainKey,
      id: `procedure-record:${sourceId}`,
      intentClass: input.intentClass,
      refs: { sourceIds: [sourceId] },
      relatedObjects: input.relatedObjects,
      scopeKey: input.scopeKey,
      status: input.status === 'failed' ? 'failed' : 'handled',
      summary: input.summary,
    });

    await writeProcedureRecordField(input.policyStateStore, record, input.ttlSeconds);
    await appendProcedureAccumulatorRecord(input.policyStateStore, record, input.ttlSeconds);

    if (shouldWriteDirectHandledMarker(input)) {
      await writeProcedureMarker(
        input.policyStateStore,
        createProcedureMarker({
          createdAt: now,
          domainKey: input.domainKey,
          expiresAt: now + input.ttlSeconds * 1000,
          intentClass: input.intentClass,
          markerType: 'handled',
          procedureKey,
          recordId: record.id,
          scopeKey: input.scopeKey,
          sourceId,
        }),
        input.ttlSeconds,
      );
    }

    await appendProcedureReceipt(
      input.policyStateStore,
      {
        createdAt: now,
        domainKey: input.domainKey,
        id: `procedure-receipt:${record.id}`,
        intentClass: input.intentClass,
        messageId: input.messageId,
        recordIds: [record.id],
        relatedObjects: input.relatedObjects,
        scopeKey: input.scopeKey,
        sourceId,
        status: input.status === 'failed' ? 'failed' : 'handled',
        summary: input.summary ?? `${input.domainKey} tool outcome handled.`,
        updatedAt: now,
      },
      { maxItems: 8, ttlSeconds: input.ttlSeconds },
    );
  }

  return { sourceId };
};

/**
 * Emits a direct tool outcome and writes its synchronous procedure projection.
 *
 * Use when:
 * - Direct tool success or failure should suppress same-source duplicate planner actions
 * - Procedure records, receipts, and accumulators must exist before async source processing
 *
 * Expects:
 * - `scopeKey` matches the later planner runtime scope
 * - `policyStateStore` is available for synchronous procedure writes
 *
 * Returns:
 * - Resolves after procedure writes and source enqueue finish
 */
export const emitToolOutcome = async (
  input: EmitToolOutcomeInput & {
    policyStateStore: AgentSignalPolicyStateStore;
    ttlSeconds: number;
  },
) => {
  const { sourceId } = await recordToolOutcome(input);

  if (input.status === 'failed') {
    await enqueueAgentSignalSourceEvent(
      {
        payload: {
          agentId: input.scope.agentId,
          domainKey: input.domainKey,
          intentClass: input.intentClass,
          messageId: input.messageId,
          operationId: input.operationId,
          outcome: {
            action: input.toolAction,
            errorReason: input.errorReason,
            status: input.status,
            summary: input.summary,
          },
          relatedObjects: input.relatedObjects,
          taskId: input.scope.taskId,
          tool: { apiName: input.apiName, identifier: input.identifier },
          toolCallId: input.toolCallId,
          topicId: input.scope.topicId,
        },
        scopeKey: input.scopeKey,
        sourceId,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
      },
      input.context,
    );
    return;
  }

  await enqueueAgentSignalSourceEvent(
    {
      payload: {
        agentId: input.scope.agentId,
        domainKey: input.domainKey,
        intentClass: input.intentClass,
        messageId: input.messageId,
        operationId: input.operationId,
        outcome: {
          action: input.toolAction,
          status: input.status,
          summary: input.summary,
        },
        relatedObjects: input.relatedObjects,
        taskId: input.scope.taskId,
        tool: { apiName: input.apiName, identifier: input.identifier },
        toolCallId: input.toolCallId,
        topicId: input.scope.topicId,
      },
      scopeKey: input.scopeKey,
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
    },
    input.context,
  );
};

/**
 * Emits a direct tool outcome without letting projection failures change tool results.
 *
 * Use when:
 * - A tool side effect has already succeeded or failed independently
 * - Procedure storage or async source enqueue should be best-effort observability
 *
 * Expects:
 * - Callers still pass structured ids so successful writes can suppress duplicates
 *
 * Returns:
 * - Resolves after best-effort emission attempt
 */
export const emitToolOutcomeSafely = async (
  input: EmitToolOutcomeInput & {
    policyStateStore: AgentSignalPolicyStateStore;
    ttlSeconds: number;
  },
) => {
  try {
    await emitToolOutcome(input);
  } catch (error) {
    console.error('[AgentSignal] Failed to emit tool outcome:', error);
  }
};
