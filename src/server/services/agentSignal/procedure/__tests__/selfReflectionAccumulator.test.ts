import type {
  AsyncSelfReflectionAccumulator,
  SelfReflectionAccumulator,
  SelfReflectionAccumulatorEventType,
  SelfReflectionAccumulatorRecordInput,
  SelfReflectionRequestReason,
} from '../accumulators/selfReflection';
import {
  createDurableSelfReflectionAccumulator,
  createSelfReflectionAccumulator,
} from '../accumulators/selfReflection';

const createInput = (
  eventType: SelfReflectionAccumulatorEventType,
  sourceId: string,
  overrides: Partial<SelfReflectionAccumulatorRecordInput> = {},
): SelfReflectionAccumulatorRecordInput => ({
  agentId: 'agent-1',
  eventType,
  sourceId,
  taskId: 'task-1',
  userId: 'user-1',
  ...overrides,
});

const recordRepeated = (
  accumulator: SelfReflectionAccumulator,
  eventType: SelfReflectionAccumulatorEventType,
  count: number,
  overrides: Partial<SelfReflectionAccumulatorRecordInput> = {},
) => {
  let decision = accumulator.record(createInput(eventType, `${eventType}-1`, overrides));

  for (let index = 2; index <= count; index += 1) {
    decision = accumulator.record(createInput(eventType, `${eventType}-${index}`, overrides));
  }

  return decision;
};

const expectRequest = (
  accumulator: SelfReflectionAccumulator,
  eventType: SelfReflectionAccumulatorEventType,
  count: number,
  reason: SelfReflectionRequestReason,
) => {
  const decision = recordRepeated(accumulator, eventType, count);

  /**
   * @example
   * expectRequest(accumulator, 'runtime_step', 6, 'runtime_step_count')
   */
  expect(decision).toMatchObject({
    reason,
    scopeId: 'task-1',
    scopeType: 'task',
    shouldRequest: true,
  });
};

/**
 * @example
 * createSelfReflectionAccumulator().record(input) returns threshold decisions for one scope.
 */
describe('selfReflectionAccumulator', () => {
  /**
   * @example
   * Two failed tool calls in the same task emit a self-reflection request.
   */
  it('requests self-reflection when failed tool threshold is reached', () => {
    const accumulator = createSelfReflectionAccumulator();

    accumulator.record(createInput('tool_failed', 'source-1'));
    const decision = accumulator.record(createInput('tool_failed', 'source-2'));

    /**
     * @example
     * expect(decision).toMatchObject({ shouldRequest: true })
     */
    expect(decision).toMatchObject({
      reason: 'failed_tool_count',
      scopeId: 'task-1',
      scopeType: 'task',
      shouldRequest: true,
    });
  });

  /**
   * @example
   * Two failed calls to the same named tool emit the same-tool threshold on the second failure.
   */
  it('requests self-reflection for the same tool failure threshold at crossing time', () => {
    const accumulator = createSelfReflectionAccumulator();

    accumulator.record(createInput('tool_failed', 'source-1', { toolName: 'searchWeb' }));
    const decision = accumulator.record(
      createInput('tool_failed', 'source-2', { toolName: 'searchWeb' }),
    );
    const staleDecision = accumulator.record(
      createInput('tool_failed', 'source-3', { toolName: 'searchWeb' }),
    );

    /**
     * @example
     * expect(decision.reason).toBe('same_tool_failure_count')
     */
    expect(decision).toMatchObject({
      reason: 'same_tool_failure_count',
      scopeId: 'task-1',
      scopeType: 'task',
      shouldRequest: true,
    });
    expect(staleDecision.shouldRequest).toBe(false);
  });

  /**
   * @example
   * Ten ordinary tool events emit the tool-call-count threshold.
   */
  it('requests self-reflection when tool call threshold is reached', () => {
    const accumulator = createSelfReflectionAccumulator();

    expectRequest(accumulator, 'tool_completed', 10, 'tool_call_count');
  });

  /**
   * @example
   * Two correction signals emit the user-correction threshold.
   */
  it('requests self-reflection when correction threshold is reached', () => {
    const accumulator = createSelfReflectionAccumulator();

    expectRequest(accumulator, 'correction', 2, 'user_correction_count');
  });

  /**
   * @example
   * Six runtime steps emit the runtime-step threshold.
   */
  it('requests self-reflection when runtime step threshold is reached', () => {
    const accumulator = createSelfReflectionAccumulator();

    expectRequest(accumulator, 'runtime_step', 6, 'runtime_step_count');
  });

  /**
   * @example
   * Three receipt signals emit the receipt threshold.
   */
  it('requests self-reflection when receipt threshold is reached', () => {
    const accumulator = createSelfReflectionAccumulator();

    expectRequest(accumulator, 'receipt', 3, 'receipt_count');
  });

  /**
   * @example
   * Execution failure emits a self-reflection request immediately.
   */
  it('requests self-reflection when execution fails', () => {
    const accumulator = createSelfReflectionAccumulator();

    const decision = accumulator.record(createInput('execution_failed', 'source-1'));

    /**
     * @example
     * expect(decision.reason).toBe('execution_failed')
     */
    expect(decision).toMatchObject({
      reason: 'execution_failed',
      scopeId: 'task-1',
      scopeType: 'task',
      shouldRequest: true,
    });
  });

  /**
   * @example
   * taskId wins over operationId and topicId when all are present.
   */
  it('prefers task scope over operation and topic scope', () => {
    const accumulator = createSelfReflectionAccumulator();

    const decision = accumulator.record(
      createInput('execution_failed', 'source-1', {
        operationId: 'operation-1',
        taskId: 'task-1',
        topicId: 'topic-1',
      }),
    );

    /**
     * @example
     * expect(decision.scopeType).toBe('task')
     */
    expect(decision).toMatchObject({
      scopeId: 'task-1',
      scopeType: 'task',
      shouldRequest: true,
    });
  });

  /**
   * @example
   * operationId is used when taskId is absent.
   */
  it('uses operation scope when task scope is absent', () => {
    const accumulator = createSelfReflectionAccumulator();

    const decision = accumulator.record(
      createInput('execution_failed', 'source-1', {
        operationId: 'operation-1',
        taskId: undefined,
        topicId: 'topic-1',
      }),
    );

    /**
     * @example
     * expect(decision.scopeType).toBe('operation')
     */
    expect(decision).toMatchObject({
      scopeId: 'operation-1',
      scopeType: 'operation',
      shouldRequest: true,
    });
  });

  /**
   * @example
   * topicId is used when taskId and operationId are absent.
   */
  it('uses topic scope when task and operation scopes are absent', () => {
    const accumulator = createSelfReflectionAccumulator();

    const decision = accumulator.record(
      createInput('execution_failed', 'source-1', {
        operationId: undefined,
        taskId: undefined,
        topicId: 'topic-1',
      }),
    );

    /**
     * @example
     * expect(decision.scopeType).toBe('topic')
     */
    expect(decision).toMatchObject({
      scopeId: 'topic-1',
      scopeType: 'topic',
      shouldRequest: true,
    });
  });

  /**
   * @example
   * Same task ids do not share counters across different users or agents.
   */
  it('isolates counters by user and agent', () => {
    const accumulator = createSelfReflectionAccumulator();

    accumulator.record(createInput('tool_failed', 'source-1'));
    const otherUserDecision = accumulator.record(
      createInput('tool_failed', 'source-2', { userId: 'user-2' }),
    );
    const otherAgentDecision = accumulator.record(
      createInput('tool_failed', 'source-3', { agentId: 'agent-2' }),
    );
    const originalScopeDecision = accumulator.record(createInput('tool_failed', 'source-4'));

    /**
     * @example
     * expect(otherUserDecision.shouldRequest).toBe(false)
     */
    expect(otherUserDecision.shouldRequest).toBe(false);
    expect(otherAgentDecision.shouldRequest).toBe(false);
    expect(originalScopeDecision).toMatchObject({
      reason: 'failed_tool_count',
      shouldRequest: true,
    });
  });

  /**
   * @example
   * Two workflow events using two accumulator instances still cross the failed-tool threshold.
   */
  it('persists threshold counters across durable accumulator instances', async () => {
    const fields = new Map<string, Record<string, string>>();
    const createAccumulator = (): AsyncSelfReflectionAccumulator =>
      createDurableSelfReflectionAccumulator({
        policyStateStore: {
          readPolicyState: async (_policyId, scopeKey) => fields.get(scopeKey),
          writePolicyState: async (_policyId, scopeKey, data) => {
            fields.set(scopeKey, { ...fields.get(scopeKey), ...data });
          },
        },
        ttlSeconds: 60,
      });

    await createAccumulator().record(
      createInput('tool_failed', 'source-1', {
        eventTimestamp: '2026-05-04T14:00:00.000Z',
      }),
    );
    const decision = await createAccumulator().record(
      createInput('tool_failed', 'source-2', {
        eventTimestamp: '2026-05-04T14:05:00.000Z',
      }),
    );

    expect(decision).toMatchObject({
      reason: 'failed_tool_count',
      scopeId: 'task-1',
      scopeType: 'task',
      shouldRequest: true,
      windowStart: '2026-05-04T14:00:00.000Z',
    });
  });

  /**
   * @example
   * Signals without taskId, operationId, or topicId never request self-reflection.
   */
  it('does not request self-reflection without a scope id', () => {
    const accumulator = createSelfReflectionAccumulator();

    const decision = accumulator.record(
      createInput('execution_failed', 'source-1', {
        operationId: undefined,
        taskId: undefined,
        topicId: undefined,
      }),
    );

    /**
     * @example
     * expect(decision.shouldRequest).toBe(false)
     */
    expect(decision.shouldRequest).toBe(false);
  });

  /**
   * @example
   * Low-signal ordinary progress does not emit a source.
   */
  it('does not request reflection below thresholds', () => {
    const accumulator = createSelfReflectionAccumulator();

    const decision = accumulator.record(
      createInput('tool_completed', 'source-1', {
        taskId: undefined,
        topicId: 'topic-1',
      }),
    );

    /**
     * @example
     * expect(decision.shouldRequest).toBe(false)
     */
    expect(decision.shouldRequest).toBe(false);
  });
});
