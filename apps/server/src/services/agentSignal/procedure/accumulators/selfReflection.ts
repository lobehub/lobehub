import type { AgentSignalPolicyStateStore } from '../../store/types';

type SelfReflectionScopeType = 'operation' | 'task' | 'topic';

const SELF_REFLECTION_ACCUMULATOR_POLICY_ID = 'self-reflection-accumulator';

export type SelfReflectionAccumulatorEventType =
  | 'correction'
  | 'execution_failed'
  | 'negative_feedback'
  | 'receipt'
  | 'runtime_step'
  | 'tool_called'
  | 'tool_completed'
  | 'tool_failed';

export type SelfReflectionRequestReason =
  | 'execution_failed'
  | 'failed_tool_count'
  | 'receipt_count'
  | 'runtime_step_count'
  | 'same_tool_failure_count'
  | 'tool_call_count'
  | 'user_correction_count';

export interface SelfReflectionAccumulatorScope {
  scopeId: string;
  scopeType: SelfReflectionScopeType;
}

export interface SelfReflectionAccumulatorThresholds {
  correctionCount: number;
  failedToolCount: number;
  receiptCount: number;
  runtimeStepCount: number;
  sameToolFailureCount: number;
  toolCallCount: number;
}

export interface SelfReflectionAccumulatorCounters {
  correctionCount: number;
  failedToolCount: number;
  negativeFeedbackCount: number;
  receiptCount: number;
  runtimeStepCount: number;
  sameToolFailureCount: number;
  toolCallCount: number;
}

export interface SelfReflectionAccumulatorRecordInput {
  agentId: string;
  eventTimestamp?: string;
  eventType: SelfReflectionAccumulatorEventType;
  operationId?: string;
  sourceId: string;
  taskId?: string;
  toolName?: string;
  topicId?: string;
  userId: string;
}

export interface SelfReflectionAccumulatorDecision {
  counters?: SelfReflectionAccumulatorCounters;
  reason?: SelfReflectionRequestReason;
  scopeId?: string;
  scopeType?: SelfReflectionScopeType;
  shouldRequest: boolean;
  windowStart?: string;
}

interface SelfReflectionAccumulatorState {
  counters: SelfReflectionAccumulatorCounters;
  emittedReasons: Set<SelfReflectionRequestReason>;
  toolFailures: Map<string, number>;
  windowStart?: string;
}

export interface SelfReflectionAccumulator {
  record: (input: SelfReflectionAccumulatorRecordInput) => SelfReflectionAccumulatorDecision;
}

export interface AsyncSelfReflectionAccumulator {
  record: (
    input: SelfReflectionAccumulatorRecordInput,
  ) => Promise<SelfReflectionAccumulatorDecision> | SelfReflectionAccumulatorDecision;
}

const DEFAULT_THRESHOLDS = {
  correctionCount: 2,
  failedToolCount: 2,
  receiptCount: 3,
  runtimeStepCount: 6,
  sameToolFailureCount: 2,
  toolCallCount: 10,
} satisfies SelfReflectionAccumulatorThresholds;

const createInitialCounters = (): SelfReflectionAccumulatorCounters => ({
  correctionCount: 0,
  failedToolCount: 0,
  negativeFeedbackCount: 0,
  receiptCount: 0,
  runtimeStepCount: 0,
  sameToolFailureCount: 0,
  toolCallCount: 0,
});

const copyCounters = (
  counters: SelfReflectionAccumulatorCounters,
): SelfReflectionAccumulatorCounters => ({
  ...counters,
});

const resolveScope = (
  input: SelfReflectionAccumulatorRecordInput,
): SelfReflectionAccumulatorScope | undefined => {
  if (input.taskId) return { scopeId: input.taskId, scopeType: 'task' };
  if (input.operationId) return { scopeId: input.operationId, scopeType: 'operation' };
  if (input.topicId) return { scopeId: input.topicId, scopeType: 'topic' };
};

const getScopeKey = (
  input: SelfReflectionAccumulatorRecordInput,
  scope: SelfReflectionAccumulatorScope,
) => `${input.userId}:${input.agentId}:${scope.scopeType}:${scope.scopeId}`;

const createState = (): SelfReflectionAccumulatorState => ({
  counters: createInitialCounters(),
  emittedReasons: new Set<SelfReflectionRequestReason>(),
  toolFailures: new Map<string, number>(),
});

const chooseEarlierTimestamp = (previous: string | undefined, next: string | undefined) => {
  if (!next) return previous;
  if (!previous) return next;

  return next < previous ? next : previous;
};

const serializeCounters = (counters: SelfReflectionAccumulatorCounters) => JSON.stringify(counters);

const parseCounters = (value: string | undefined): SelfReflectionAccumulatorCounters => {
  if (!value) return createInitialCounters();

  try {
    const parsed = JSON.parse(value) as Partial<SelfReflectionAccumulatorCounters>;

    return {
      correctionCount: Number(parsed.correctionCount ?? 0),
      failedToolCount: Number(parsed.failedToolCount ?? 0),
      negativeFeedbackCount: Number(parsed.negativeFeedbackCount ?? 0),
      receiptCount: Number(parsed.receiptCount ?? 0),
      runtimeStepCount: Number(parsed.runtimeStepCount ?? 0),
      sameToolFailureCount: Number(parsed.sameToolFailureCount ?? 0),
      toolCallCount: Number(parsed.toolCallCount ?? 0),
    };
  } catch {
    return createInitialCounters();
  }
};

const serializeReasons = (reasons: Set<SelfReflectionRequestReason>) =>
  JSON.stringify([...reasons]);

const parseReasons = (value: string | undefined): Set<SelfReflectionRequestReason> => {
  if (!value) return new Set<SelfReflectionRequestReason>();

  try {
    const parsed = JSON.parse(value);

    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is SelfReflectionRequestReason => typeof item === 'string')
        : [],
    );
  } catch {
    return new Set<SelfReflectionRequestReason>();
  }
};

const serializeToolFailures = (toolFailures: Map<string, number>) =>
  JSON.stringify(Object.fromEntries(toolFailures));

const parseToolFailures = (value: string | undefined): Map<string, number> => {
  if (!value) return new Map<string, number>();

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Map<string, number>();
    }

    return new Map(
      Object.entries(parsed)
        .map(([key, count]) => [key, Number(count)] as const)
        .filter(([, count]) => Number.isFinite(count)),
    );
  } catch {
    return new Map<string, number>();
  }
};

const createStateFromStoredFields = (
  fields: Awaited<ReturnType<AgentSignalPolicyStateStore['readPolicyState']>>,
): SelfReflectionAccumulatorState => ({
  counters: parseCounters(fields?.counters),
  emittedReasons: parseReasons(fields?.emittedReasons),
  toolFailures: parseToolFailures(fields?.toolFailures),
  windowStart: fields?.windowStart,
});

const createDecisionAfterRecord = (
  input: SelfReflectionAccumulatorRecordInput,
  scope: SelfReflectionAccumulatorScope,
  state: SelfReflectionAccumulatorState,
): SelfReflectionAccumulatorDecision => {
  const previousCounters = copyCounters(state.counters);

  state.windowStart = chooseEarlierTimestamp(state.windowStart, input.eventTimestamp);
  incrementCounters(state, input);

  const newlyCrossedReasons = getNewlyCrossedReasons(
    previousCounters,
    state.counters,
    input.eventType,
  );
  const reason = newlyCrossedReasons.find(
    (crossedReason) => !state.emittedReasons.has(crossedReason),
  );

  for (const crossedReason of newlyCrossedReasons) {
    state.emittedReasons.add(crossedReason);
  }

  if (!reason) {
    return { counters: copyCounters(state.counters), shouldRequest: false };
  }

  return {
    counters: copyCounters(state.counters),
    reason,
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
    shouldRequest: true,
    windowStart: state.windowStart,
  };
};

const incrementCounters = (
  state: SelfReflectionAccumulatorState,
  input: SelfReflectionAccumulatorRecordInput,
) => {
  const { counters } = state;

  switch (input.eventType) {
    case 'correction': {
      counters.correctionCount += 1;
      break;
    }

    case 'execution_failed': {
      break;
    }

    case 'negative_feedback': {
      counters.negativeFeedbackCount += 1;
      break;
    }

    case 'receipt': {
      counters.receiptCount += 1;
      break;
    }

    case 'runtime_step': {
      counters.runtimeStepCount += 1;
      break;
    }

    case 'tool_called':
    case 'tool_completed': {
      counters.toolCallCount += 1;
      break;
    }

    case 'tool_failed': {
      counters.failedToolCount += 1;
      counters.toolCallCount += 1;

      if (input.toolName) {
        const toolFailureCount = (state.toolFailures.get(input.toolName) ?? 0) + 1;

        state.toolFailures.set(input.toolName, toolFailureCount);
        counters.sameToolFailureCount = Math.max(counters.sameToolFailureCount, toolFailureCount);
      }

      break;
    }
  }
};

const didCrossThreshold = (previous: number, next: number, threshold: number) =>
  previous < threshold && next >= threshold;

const getNewlyCrossedReasons = (
  previous: SelfReflectionAccumulatorCounters,
  next: SelfReflectionAccumulatorCounters,
  eventType: SelfReflectionAccumulatorEventType,
): SelfReflectionRequestReason[] => {
  const reasons: SelfReflectionRequestReason[] = [];

  if (eventType === 'execution_failed') reasons.push('execution_failed');
  if (
    didCrossThreshold(
      previous.sameToolFailureCount,
      next.sameToolFailureCount,
      DEFAULT_THRESHOLDS.sameToolFailureCount,
    )
  ) {
    reasons.push('same_tool_failure_count');
  }
  if (
    didCrossThreshold(
      previous.failedToolCount,
      next.failedToolCount,
      DEFAULT_THRESHOLDS.failedToolCount,
    )
  ) {
    reasons.push('failed_tool_count');
  }
  if (
    didCrossThreshold(previous.toolCallCount, next.toolCallCount, DEFAULT_THRESHOLDS.toolCallCount)
  ) {
    reasons.push('tool_call_count');
  }
  if (
    didCrossThreshold(
      previous.correctionCount,
      next.correctionCount,
      DEFAULT_THRESHOLDS.correctionCount,
    )
  ) {
    reasons.push('user_correction_count');
  }
  if (
    didCrossThreshold(
      previous.runtimeStepCount,
      next.runtimeStepCount,
      DEFAULT_THRESHOLDS.runtimeStepCount,
    )
  ) {
    reasons.push('runtime_step_count');
  }
  if (
    didCrossThreshold(previous.receiptCount, next.receiptCount, DEFAULT_THRESHOLDS.receiptCount)
  ) {
    reasons.push('receipt_count');
  }

  return reasons;
};

/** Creates an in-memory weak-signal accumulator for one runtime or test lifecycle. */
export const createSelfReflectionAccumulator = (): SelfReflectionAccumulator => {
  const scopes = new Map<string, SelfReflectionAccumulatorState>();

  return {
    record: (input) => {
      const scope = resolveScope(input);

      if (!scope) return { shouldRequest: false };

      const scopeKey = getScopeKey(input, scope);
      const state = scopes.get(scopeKey) ?? createState();

      scopes.set(scopeKey, state);
      return createDecisionAfterRecord(input, scope, state);
    },
  };
};

/** Creates a durable weak-signal accumulator for workflow events processed one at a time. */
export const createDurableSelfReflectionAccumulator = (input: {
  policyStateStore: AgentSignalPolicyStateStore;
  ttlSeconds: number;
}): AsyncSelfReflectionAccumulator => ({
  record: async (recordInput) => {
    const scope = resolveScope(recordInput);

    if (!scope) return { shouldRequest: false };

    const scopeKey = getScopeKey(recordInput, scope);
    const state = createStateFromStoredFields(
      await input.policyStateStore.readPolicyState(SELF_REFLECTION_ACCUMULATOR_POLICY_ID, scopeKey),
    );
    const decision = createDecisionAfterRecord(recordInput, scope, state);

    await input.policyStateStore.writePolicyState(
      SELF_REFLECTION_ACCUMULATOR_POLICY_ID,
      scopeKey,
      {
        counters: serializeCounters(state.counters),
        emittedReasons: serializeReasons(state.emittedReasons),
        lastSourceId: recordInput.sourceId,
        toolFailures: serializeToolFailures(state.toolFailures),
        version: '1',
        ...(state.windowStart ? { windowStart: state.windowStart } : {}),
      },
      input.ttlSeconds,
    );

    return decision;
  },
});
