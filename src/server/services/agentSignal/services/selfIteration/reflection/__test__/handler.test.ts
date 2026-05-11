// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfReflectionRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultAgentSignalPolicies } from '../../../../policies';
import type { RuntimeProcessorContext } from '../../../../runtime/context';
import type {
  AgentSignalActionHandlerDefinition,
  AgentSignalSignalHandlerDefinition,
  AgentSignalSourceHandlerDefinition,
} from '../../../../runtime/middleware';
import type { ExecuteSelfIterationResult } from '../../execute';
import { ReviewRunStatus, Scope } from '../../types';
import type {
  CreateSelfReflectionSourceHandlerDependencies,
  SelfReflectionReviewContext,
} from '../handler';
import {
  createSelfReflectionSourceHandler,
  createSelfReflectionSourcePolicyHandler,
} from '../handler';

const reflectionPayload = {
  agentId: 'agent-1',
  operationId: 'operation-1',
  reason: 'failed_tool_count',
  scopeId: 'task-1',
  scopeType: 'task',
  taskId: 'task-1',
  topicId: 'topic-1',
  userId: 'user-1',
  windowEnd: '2026-05-04T14:30:00.000Z',
  windowStart: '2026-05-04T14:00:00.000Z',
} as const;

const reflectionSourceId =
  'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z';

const runtimeContext = {
  now: () => 100,
  runtimeState: {
    getGuardState: async () => ({}),
    touchGuardState: async () => ({}),
  },
  scopeKey: 'agent:agent-1',
} satisfies RuntimeProcessorContext;

const createReflectionSource = (
  payload: Record<string, unknown> = reflectionPayload,
  sourceType = AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
): SourceAgentSelfReflectionRequested =>
  createSource({
    payload,
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'agent:agent-1',
    sourceId: reflectionSourceId,
    sourceType,
    timestamp: 100,
  }) as SourceAgentSelfReflectionRequested;

const reflectionContext = {
  agentId: 'agent-1',
  evidence: [{ id: 'task-1', type: 'task' }],
  operationId: 'operation-1',
  scopeId: 'task-1',
  scopeType: 'task',
  taskId: 'task-1',
  topicId: 'topic-1',
  userId: 'user-1',
  windowEnd: reflectionPayload.windowEnd,
  windowStart: reflectionPayload.windowStart,
} satisfies SelfReflectionReviewContext;

const runtimeResult = {
  actions: [
    {
      result: {
        receiptId: 'runtime-receipt-1',
        resourceId: 'memory-1',
        status: 'applied',
        summary: 'Memory written.',
      },
      toolName: 'writeMemory',
    },
  ],
  content: 'Runtime reflection wrote one memory.',
  ideas: [],
  intents: [
    {
      confidence: 0.82,
      evidenceRefs: [{ id: 'task-1', type: 'task' }],
      idempotencyKey: `${reflectionSourceId}:intent:memory`,
      intentType: 'memory',
      mode: 'reflection',
      rationale: 'Capture the same-turn preference.',
      risk: 'low',
      urgency: 'soon',
    },
  ],
  status: ReviewRunStatus.Completed,
  stepCount: 2,
  toolCalls: [
    {
      apiName: 'writeMemory',
      arguments: JSON.stringify({
        content: 'User prefers scoped task follow-up.',
        evidenceRefs: [{ id: 'task-1', type: 'task' }],
        idempotencyKey: `${reflectionSourceId}:writeMemory:tool-call-1`,
      }),
      id: 'tool-call-1',
      identifier: 'agent-signal-self-iteration',
      type: 'builtin',
    },
  ],
  usage: [],
  writeOutcomes: [
    {
      result: {
        receiptId: 'runtime-receipt-1',
        resourceId: 'memory-1',
        status: 'applied',
        summary: 'Memory written.',
      },
      toolName: 'writeMemory',
    },
  ],
} satisfies ExecuteSelfIterationResult;

const createDependencies = (
  overrides: Partial<CreateSelfReflectionSourceHandlerDependencies> = {},
): CreateSelfReflectionSourceHandlerDependencies => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  collectContext: vi.fn(async () => reflectionContext),
  executeSelfIteration: vi.fn(async () => runtimeResult),
  maxSteps: 3,
  model: 'gpt-test',
  modelRuntime: { chat: vi.fn() },
  tools: {} as never,
  writeReceipt: vi.fn(async () => {}),
  ...overrides,
});

describe('self-reflection source handler', () => {
  /**
   * @example
   * expect(deps.executeSelfIteration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reflection' }));
   * expect(deps.executeSelfIteration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reflection' }));
   */
  it('runs self-iteration executor for reflection and records reflection metadata on receipts', async () => {
    const deps = createDependencies({ writeReceipts: vi.fn(async () => {}) });
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(deps.executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        context: reflectionContext,
        maxSteps: 3,
        mode: 'reflection',
        sourceId: reflectionSourceId,
        userId: 'user-1',
        window: {
          end: reflectionPayload.windowEnd,
          start: reflectionPayload.windowStart,
        },
      }),
    );
    expect(deps.writeReceipts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: `${reflectionSourceId}:review-summary`,
        metadata: expect.objectContaining({
          selfIteration: expect.objectContaining({
            intents: runtimeResult.intents,
            mode: 'reflection',
            reason: 'failed_tool_count',
            sourceId: reflectionSourceId,
          }),
        }),
      }),
      expect.objectContaining({ id: `${reflectionSourceId}:writeMemory:tool-call-1:action` }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        plannedActionCount: 1,
        planSummary: 'Runtime reflection wrote one memory.',
        status: ReviewRunStatus.Completed,
      }),
    );
  });

  /**
   * @example
   * expect(runtimeFactory.createRuntime).toHaveBeenCalledWith(expect.objectContaining({ context }));
   * expect(executeSelfIteration).toHaveBeenCalledWith(expect.objectContaining({ tools }));
   */
  it('builds self-iteration executor dependencies through the per-source runtime factory', async () => {
    const executeSelfIteration = vi.fn(async () => runtimeResult);
    const modelRuntime = { chat: vi.fn() };
    const tools = {} as never;
    const runtimeFactory = {
      createRuntime: vi.fn(async () => ({
        executeSelfIteration,
        maxSteps: 4,
        model: 'gpt-factory',
        modelRuntime,
        tools,
      })),
    };
    const deps = createDependencies({
      runtimeFactory,
      writeReceipts: vi.fn(async () => {}),
    });
    const handler = createSelfReflectionSourceHandler(deps);

    await handler.handle(createReflectionSource());

    expect(runtimeFactory.createRuntime).toHaveBeenCalledWith({
      context: reflectionContext,
      payload: reflectionPayload,
      source: expect.objectContaining({ sourceId: reflectionSourceId }),
    });
    expect(executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSteps: 4,
        model: 'gpt-factory',
        modelRuntime,
        mode: 'reflection',
        tools,
      }),
    );
  });

  /**
   * @example
   * expect(result.status).toBe('completed');
   */
  it('orchestrates scoped collector self-iteration executor and receipt writer', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(deps.canRunReview).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        guardKey: reflectionSourceId,
        reason: 'failed_tool_count',
        scopeId: 'task-1',
        scopeType: 'task',
        userId: 'user-1',
      }),
    );
    expect(deps.acquireReviewGuard).toHaveBeenCalledWith(
      expect.objectContaining({ guardKey: reflectionSourceId }),
    );
    expect(deps.collectContext).toHaveBeenCalledWith({
      agentId: 'agent-1',
      operationId: 'operation-1',
      scopeId: 'task-1',
      scopeType: 'task',
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'user-1',
      windowEnd: reflectionPayload.windowEnd,
      windowStart: reflectionPayload.windowStart,
    });
    expect(deps.executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        context: reflectionContext,
        mode: 'reflection',
        sourceId: reflectionSourceId,
      }),
    );
    expect(deps.writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: expect.objectContaining({
          status: runtimeResult.status,
          summaryReceiptId: `${reflectionSourceId}:review-summary`,
        }),
        intents: runtimeResult.intents,
        plan: expect.objectContaining({
          reviewScope: Scope.SelfReflection,
          summary: runtimeResult.content,
        }),
        reason: 'failed_tool_count',
        scopeId: 'task-1',
        scopeType: 'task',
        sourceId: reflectionSourceId,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        execution: expect.objectContaining({ status: runtimeResult.status }),
        plannedActionCount: 1,
        planSummary: 'Runtime reflection wrote one memory.',
        sourceId: reflectionSourceId,
        status: ReviewRunStatus.Completed,
        userId: 'user-1',
      }),
    );
  });

  /**
   * @example
   * expect(deps.writeReceipt).toHaveBeenCalledTimes(1);
   */
  it('emits receipts without requiring a daily brief dependency', async () => {
    const deps = createDependencies({ writeReceipts: vi.fn(async () => {}) });
    const handler = createSelfReflectionSourceHandler(deps);

    await handler.handle(createReflectionSource());

    expect(deps.writeReceipts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: `${reflectionSourceId}:review-summary` }),
        expect.objectContaining({
          id: `${reflectionSourceId}:writeMemory:tool-call-1:action`,
        }),
      ]),
    );
    expect(deps.writeReceipt).toHaveBeenCalledTimes(1);
    expect('writeDailyBrief' in deps).toBe(false);
  });

  /**
   * @example
   * expect(result.status).toBe('completed');
   */
  it('keeps applied self-reflection runs completed when receipt writing fails', async () => {
    const receiptError = new Error('receipt store unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = createDependencies({
      writeReceipt: vi.fn(async () => {
        throw receiptError;
      }),
    });
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(result).toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ status: runtimeResult.status }),
        status: ReviewRunStatus.Completed,
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[AgentSignal] Failed to write self-reflection receipt:',
      receiptError,
    );
    consoleError.mockRestore();
  });

  /**
   * @example
   * expect(result.status).toBe('deduped');
   */
  it('returns deduped without collecting when the review guard is already held', async () => {
    const deps = createDependencies({
      acquireReviewGuard: vi.fn(async () => false),
    });
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(result).toEqual(
      expect.objectContaining({
        guardKey: reflectionSourceId,
        status: ReviewRunStatus.Deduped,
      }),
    );
    expect(deps.collectContext).not.toHaveBeenCalled();
    expect(deps.executeSelfIteration).not.toHaveBeenCalled();
    expect(deps.writeReceipt).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.reason).toBe('gate_disabled');
   */
  it('returns skipped without acquiring the guard when gates reject the review', async () => {
    const deps = createDependencies({
      canRunReview: vi.fn(async () => false),
    });
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(createReflectionSource());

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'gate_disabled',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.collectContext).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.reason).toBe('invalid_payload');
   */
  it('returns skipped invalid without throwing for invalid payloads', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(
      createReflectionSource({ agentId: 'agent-1', userId: 'user-1' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.collectContext).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.reason).toBe('invalid_payload');
   */
  it('returns skipped invalid when scope type is outside the supported set', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const result = await handler.handle(
      createReflectionSource({
        ...reflectionPayload,
        scopeType: 'session',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.reason).toBe('invalid_payload');
   */
  it('returns skipped invalid when source id does not match the expected self-reflection key', async () => {
    const deps = createDependencies();
    const handler = createSelfReflectionSourceHandler(deps);

    const mismatchedSource = {
      ...createReflectionSource(),
      sourceId:
        'self-reflection:user-1:agent-1:task:task-1:wrong:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
    } satisfies SourceAgentSelfReflectionRequested;
    const result = await handler.handle(mismatchedSource);

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        sourceId:
          'self-reflection:user-1:agent-1:task:task-1:wrong:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.collectContext).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(sourceHandlers[0].listen).toBe('agent.self_reflection.requested');
   */
  it('installs an optional self-reflection source policy through default policy composition', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const deps = createDependencies();
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in self-reflection registration test.',
            result: 'neutral',
          }),
        },
      },
      selfReflection: deps,
    });

    for (const policy of policies) {
      await policy.install({
        handleAction(handler: AgentSignalActionHandlerDefinition) {
          expect(handler.type).toBe('action');
        },
        handleSignal(handler: AgentSignalSignalHandlerDefinition) {
          expect(handler.type).toBe('signal');
        },
        handleSource(handler) {
          sourceHandlers.push(handler);
        },
      });
    }

    const selfReflectionHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
    );

    expect(selfReflectionHandler).toEqual(
      expect.objectContaining({
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested}:shared-review`,
        type: 'source',
      }),
    );

    const runtimeResult = await selfReflectionHandler?.handle(
      createReflectionSource(),
      runtimeContext,
    );

    expect(runtimeResult).toEqual(
      expect.objectContaining({
        concluded: expect.objectContaining({ status: ReviewRunStatus.Completed }),
        status: 'conclude',
      }),
    );
  });

  /**
   * @example
   * expect(selfReflectionHandler).toBeUndefined();
   */
  it('does not install self-reflection source handlers without self-reflection dependencies', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in self-reflection registration test.',
            result: 'neutral',
          }),
        },
      },
    });

    for (const policy of policies) {
      await policy.install({
        handleAction(handler: AgentSignalActionHandlerDefinition) {
          expect(handler.type).toBe('action');
        },
        handleSignal(handler: AgentSignalSignalHandlerDefinition) {
          expect(handler.type).toBe('signal');
        },
        handleSource(handler) {
          sourceHandlers.push(handler);
        },
      });
    }

    const selfReflectionHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
    );

    expect(selfReflectionHandler).toBeUndefined();
  });
});

describe('self-reflection source policy handler', () => {
  /**
   * @example
   * expect(handler.listen).toBe('agent.self_reflection.requested');
   */
  it('listens to the self-reflection requested source type', () => {
    const handler = createSelfReflectionSourcePolicyHandler(createDependencies());

    expect(handler.listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested);
  });
});
