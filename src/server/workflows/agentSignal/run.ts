import type { ExecutionSnapshot, ISnapshotStore, StepSnapshot } from '@lobechat/agent-tracing';
import { messages } from '@lobechat/database/schemas';
import debug from 'debug';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { getServerDB } from '@/database/server';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';
import type { GeneratedAgentSignalEmissionResult } from '@/server/services/agentSignal/orchestrator';
import { executeAgentSignalSourceEvent } from '@/server/services/agentSignal/orchestrator';
import { assembleFeedbackContext } from '@/server/services/agentSignal/policies/analyzeIntent/context/feedbackContextAssembler';
import { createRedisRuntimeGuardBackend } from '@/server/services/agentSignal/runtime/backend/redisGuard';
import {
  AGENT_SIGNAL_SOURCE_TYPES,
  type AgentSignalSourcePayloadMap,
  type AgentSignalSourceType,
  type SourceAgentUserMessage,
  type SourceClientRuntimeStart,
} from '@/server/services/agentSignal/sourceTypes';

import type { AgentSignalWorkflowRunPayload } from './index';

const log = debug('lobe-server:workflows:agent-signal:run');

const isGeneratedEmission = (
  value: Awaited<ReturnType<typeof executeAgentSignalSourceEvent>> | undefined,
): value is GeneratedAgentSignalEmissionResult => {
  return Boolean(value && !value.deduped);
};

/**
 * Minimal workflow context contract used by the Agent Signal workflow runner.
 *
 * @param TPayload - Workflow request payload type.
 */
export interface AgentSignalWorkflowContext<TPayload = AgentSignalWorkflowRunPayload> {
  requestPayload?: TPayload;
  run: <TResult>(stepId: string, handler: () => Promise<TResult>) => Promise<TResult>;
}

/** Dependencies for executing one Agent Signal workflow payload. */
export interface RunAgentSignalWorkflowDeps {
  createRuntimeGuardBackend?: typeof createRedisRuntimeGuardBackend;
  createSnapshotStore?: () => ISnapshotStore | null;
  executeSourceEvent?: typeof executeAgentSignalSourceEvent;
  getDb?: typeof getServerDB;
}

/**
 * One normalized workflow source event after ingress bridging.
 *
 * @param TSourceType - Concrete Agent Signal source type after normalization.
 */
interface NormalizedWorkflowSourceEventInput<
  TSourceType extends AgentSignalSourceType = AgentSignalSourceType,
> {
  payload: AgentSignalSourcePayloadMap[TSourceType];
  scopeKey: string;
  sourceId: string;
  sourceType: TSourceType;
  timestamp: number;
}

const createDefaultSnapshotStore = (): ISnapshotStore | null => {
  if (process.env.NODE_ENV !== 'development') return null;

  try {
    // NOTICE:
    // Workflow-triggered Agent Signal runs do not pass through AgentRuntimeService.executeStep(),
    // so they never hit the normal dev snapshot recorder path. We lazily require the file-backed
    // store here to bridge those workflow-only runs into `.agent-tracing/` for local debugging.
    // Removal condition:
    // - Safe to remove only if workflow executions share the same snapshot recorder as executeStep.
    // Source/context:
    // - `AgentRuntimeService` records `agent_signal.*` events into step snapshots.
    // - `runAgentSignalWorkflow` only persisted OTel observability before this bridge.
    // - `agent-tracing inspect -S` therefore showed zero events for workflow-triggered runs.

    const { FileSnapshotStore } = require('@lobechat/agent-tracing');
    return new FileSnapshotStore();
  } catch {
    return null;
  }
};

const resolveSnapshotOperationId = (result: GeneratedAgentSignalEmissionResult) => {
  const payloadOperationId =
    typeof result.source.payload === 'object' &&
    result.source.payload !== null &&
    'operationId' in result.source.payload &&
    typeof result.source.payload.operationId === 'string'
      ? result.source.payload.operationId
      : undefined;

  return payloadOperationId ?? result.source.sourceId;
};

const toWorkflowStepSnapshot = (result: GeneratedAgentSignalEmissionResult): StepSnapshot => {
  const events = toAgentSignalTraceEvents({
    actions: result.orchestration.actions,
    results: result.orchestration.results,
    signals: result.orchestration.emittedSignals,
    source: result.source,
  });
  const startedAt = result.source.timestamp;
  const completedAt =
    Math.max(
      startedAt,
      ...events
        .map((event) => event.timestamp)
        .filter((timestamp): timestamp is number => typeof timestamp === 'number'),
    ) || startedAt;

  return {
    completedAt,
    context: {
      payload: {
        scopeKey: result.source.scopeKey,
        sourceId: result.source.sourceId,
        sourceType: result.source.sourceType,
      },
      phase: 'agent_signal_workflow',
    },
    events,
    executionTimeMs: Math.max(0, completedAt - startedAt),
    startedAt,
    stepIndex: 0,
    stepType: 'call_tool',
    totalCost: 0,
    totalTokens: 0,
  };
};

const persistWorkflowSnapshot = async (
  result: GeneratedAgentSignalEmissionResult,
  store: ISnapshotStore,
  userId: string,
) => {
  const operationId = resolveSnapshotOperationId(result);
  const step = toWorkflowStepSnapshot(result);
  const snapshot: ExecutionSnapshot = {
    agentId:
      typeof result.source.payload === 'object' &&
      result.source.payload !== null &&
      'agentId' in result.source.payload &&
      typeof result.source.payload.agentId === 'string'
        ? result.source.payload.agentId
        : undefined,
    completedAt: step.completedAt,
    completionReason: 'done',
    operationId,
    startedAt: step.startedAt,
    steps: [step],
    topicId:
      typeof result.source.payload === 'object' &&
      result.source.payload !== null &&
      'topicId' in result.source.payload &&
      typeof result.source.payload.topicId === 'string'
        ? result.source.payload.topicId
        : undefined,
    totalCost: 0,
    totalSteps: 1,
    totalTokens: 0,
    traceId: operationId,
    userId,
  };

  await store.save(snapshot);
};

const isClientRuntimeStartSource = (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
): sourceEvent is NormalizedWorkflowSourceEventInput<SourceClientRuntimeStart['sourceType']> => {
  return sourceEvent.sourceType === AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart;
};

const isAgentUserMessageSource = (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
): sourceEvent is NormalizedWorkflowSourceEventInput<SourceAgentUserMessage['sourceType']> => {
  return sourceEvent.sourceType === AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage;
};

/**
 * Rebuilds one `agent.user.message` source from the client runtime-start event.
 *
 * Use when:
 * - The browser only emits `client.runtime.start`
 * - Feedback policies still need the original user message content
 *
 * Expects:
 * - `sourceEvent.payload.parentMessageType === 'user'`
 * - `sourceEvent.payload.parentMessageId` belongs to the same `userId`
 *
 * Returns:
 * - One normalized `agent.user.message` source when the parent user message exists
 * - Otherwise returns `undefined` so the original client source can continue unchanged
 */
const bridgeClientRuntimeStartToAgentUserMessage = async (
  sourceEvent: NormalizedWorkflowSourceEventInput<SourceClientRuntimeStart['sourceType']>,
  input: { db: Awaited<ReturnType<typeof getServerDB>>; userId: string },
): Promise<
  NormalizedWorkflowSourceEventInput<SourceAgentUserMessage['sourceType']> | undefined
> => {
  if (sourceEvent.payload.parentMessageType !== 'user') return undefined;
  if (typeof sourceEvent.payload.parentMessageId !== 'string') return undefined;

  const messageModel = new MessageModel(input.db, input.userId);
  const parentMessage = await messageModel.findById(sourceEvent.payload.parentMessageId);

  if (!parentMessage?.content) return undefined;

  return {
    payload: {
      agentId:
        typeof sourceEvent.payload.agentId === 'string' ? sourceEvent.payload.agentId : undefined,
      message: parentMessage.content,
      messageId: parentMessage.id,
      serializedContext:
        typeof sourceEvent.payload.serializedContext === 'string'
          ? sourceEvent.payload.serializedContext
          : undefined,
      threadId:
        typeof sourceEvent.payload.threadId === 'string' ? sourceEvent.payload.threadId : undefined,
      topicId:
        typeof sourceEvent.payload.topicId === 'string' ? sourceEvent.payload.topicId : undefined,
      trigger: 'client.runtime.start',
    },
    scopeKey: sourceEvent.scopeKey,
    sourceId: parentMessage.id,
    sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
    timestamp: sourceEvent.timestamp,
  };
};

const buildFeedbackSourceSerializedContext = async (
  sourceEvent: NormalizedWorkflowSourceEventInput<SourceAgentUserMessage['sourceType']>,
  input: { db: Awaited<ReturnType<typeof getServerDB>>; userId: string },
): Promise<string | undefined> => {
  if (typeof sourceEvent.payload.serializedContext === 'string') {
    return sourceEvent.payload.serializedContext;
  }

  if (typeof sourceEvent.payload.topicId !== 'string') return undefined;

  const messageModel = new MessageModel(input.db, input.userId);
  const anchorMessage = await messageModel.findById(sourceEvent.payload.messageId);

  if (!anchorMessage?.createdAt) return undefined;

  const threadScopeFilter =
    typeof sourceEvent.payload.threadId === 'string'
      ? eq(messages.threadId, sourceEvent.payload.threadId)
      : isNull(messages.threadId);

  const recentMessages = await input.db.query.messages.findMany({
    limit: 10,
    orderBy: [desc(messages.createdAt)],
    where: and(
      eq(messages.userId, input.userId),
      eq(messages.topicId, sourceEvent.payload.topicId),
      lte(messages.createdAt, anchorMessage.createdAt),
      threadScopeFilter,
    ),
  });

  // TODO: serialize recent tool calls / tool results into feedback analysis context when we finalize the context format.
  return assembleFeedbackContext({
    feedbackMessage: {
      content: sourceEvent.payload.message,
      id: sourceEvent.payload.messageId,
      role: 'user',
    },
    messages: [...recentMessages]
      .reverse()
      .map((message) => ({ content: message.content, id: message.id, role: message.role })),
  }).serializedContext;
};

const enrichFeedbackSourceSerializedContext = async (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
  input: { db: Awaited<ReturnType<typeof getServerDB>>; userId: string },
): Promise<AgentSignalWorkflowRunPayload['sourceEvent']> => {
  if (!isAgentUserMessageSource(sourceEvent)) return sourceEvent;

  const serializedContext = await buildFeedbackSourceSerializedContext(sourceEvent, input);

  if (typeof serializedContext !== 'string') return sourceEvent;

  return {
    ...sourceEvent,
    payload: {
      ...sourceEvent.payload,
      serializedContext,
    },
  };
};

/**
 * Normalizes one workflow source event into the runtime-facing source catalog.
 *
 * Use when:
 * - Workflow ingress receives browser lifecycle events
 * - Downstream policies expect richer server-owned sources such as `agent.user.message`
 *
 * Expects:
 * - `db` and `userId` point at the same message store used by the originating chat session
 *
 * Returns:
 * - The bridged source when one ingress adapter applies
 * - Otherwise the original workflow source event
 *
 * Call stack:
 *
 * {@link runAgentSignalWorkflow}
 *   -> {@link normalizeWorkflowSourceEvent}
 *     -> {@link bridgeClientRuntimeStartToAgentUserMessage}
 *       -> {@link MessageModel.findById}
 */
const normalizeWorkflowSourceEvent = async (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
  input: { db: Awaited<ReturnType<typeof getServerDB>>; userId: string },
): Promise<AgentSignalWorkflowRunPayload['sourceEvent']> => {
  if (isClientRuntimeStartSource(sourceEvent)) {
    const bridgedSourceEvent =
      (await bridgeClientRuntimeStartToAgentUserMessage(sourceEvent, input)) ?? sourceEvent;

    return enrichFeedbackSourceSerializedContext(bridgedSourceEvent, input);
  }

  return enrichFeedbackSourceSerializedContext(sourceEvent, input);
};

/**
 * Runs one normalized Agent Signal source event inside the workflow worker.
 *
 * Use when:
 * - The Next.js Upstash route needs a plain function for testable execution
 * - Tests or local harnesses need the exact workflow worker logic without HTTP indirection
 *
 * Expects:
 * - `context.requestPayload` contains `userId` and one normalized `sourceEvent`
 *
 * Returns:
 * - A small execution summary mirroring the workflow route response
 */
export const runAgentSignalWorkflow = async (
  context: AgentSignalWorkflowContext,
  deps: RunAgentSignalWorkflowDeps = {},
) => {
  const payload = context.requestPayload;

  if (!payload?.userId || !payload.sourceEvent) {
    return { error: 'Missing userId or sourceEvent', success: false } as const;
  }

  log('Worker received payload=%O', payload);

  const getDb = deps.getDb ?? getServerDB;
  const executeSourceEvent = deps.executeSourceEvent ?? executeAgentSignalSourceEvent;
  const createGuardBackend = deps.createRuntimeGuardBackend ?? createRedisRuntimeGuardBackend;
  const snapshotStore = (deps.createSnapshotStore ?? createDefaultSnapshotStore)();

  const db = await getDb();
  const normalizedSourceEvent = await normalizeWorkflowSourceEvent(payload.sourceEvent, {
    db,
    userId: payload.userId,
  });
  const result = await context.run(
    `agent-signal:execute:${normalizedSourceEvent.sourceType}:${normalizedSourceEvent.sourceId}`,
    () =>
      executeSourceEvent(
        normalizedSourceEvent,
        {
          agentId: payload.agentId,
          db,
          userId: payload.userId,
        },
        {
          runtimeGuardBackend: createGuardBackend(),
        },
      ),
  );

  log('Processed source event result=%O', {
    deduped: result?.deduped ?? true,
    orchestration:
      result && !result.deduped
        ? {
            actionTypes: result.orchestration.actions.map((action) => action.actionType),
            resultStatuses: result.orchestration.results.map((item) => item.status),
            runtimeStatus:
              'runtimeResult' in result.orchestration
                ? result.orchestration.runtimeResult.status
                : undefined,
            signalTypes: result.orchestration.emittedSignals.map((signal) => signal.signalType),
          }
        : undefined,
    scopeKey: payload.sourceEvent.scopeKey,
    sourceId: normalizedSourceEvent.sourceId,
    sourceType: normalizedSourceEvent.sourceType,
  });

  if (snapshotStore && isGeneratedEmission(result)) {
    try {
      await persistWorkflowSnapshot(result, snapshotStore, payload.userId);
    } catch (error) {
      log('Persist workflow snapshot failed error=%O', error);
    }
  }

  return {
    deduped: result?.deduped ?? true,
    emittedSignals: isGeneratedEmission(result) ? result.orchestration.emittedSignals.length : 0,
    scopeKey: normalizedSourceEvent.scopeKey,
    sourceId: normalizedSourceEvent.sourceId,
    success: true,
  } as const;
};
