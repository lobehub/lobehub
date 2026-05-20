// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfFeedbackIntentDeclared } from '@lobechat/agent-signal/source';
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
import type { EvidenceRef } from '../../types';
import { ReviewRunStatus } from '../../types';
import type { CreateSelfFeedbackIntentSourceHandlerDependencies } from '../handler';
import {
  createSelfFeedbackIntentSourceHandler,
  createSelfFeedbackIntentSourcePolicyHandler,
} from '../handler';

const intentPayload = {
  action: 'write',
  agentId: 'agent-1',
  confidence: 0.94,
  evidenceRefs: [
    {
      id: 'msg-1',
      summary: 'User asked to remember concise release summaries.',
      type: 'message',
    },
  ],
  kind: 'memory',
  reason: 'The user gave a durable preference.',
  summary: 'User prefers concise release summaries.',
  toolCallId: 'tool-call-1',
  topicId: 'topic-1',
  userId: 'user-1',
} as const;

const intentSourceId = 'self-feedback-intent:user-1:agent-1:topic:topic-1:tool-call-1';

const topicEvidence = {
  id: 'topic-1',
  summary: 'Current topic context.',
  type: 'topic',
} satisfies EvidenceRef;

const runtimeResult = {
  actions: [
    {
      result: {
        receiptId: 'runtime-memory-receipt',
        resourceId: 'memory-1',
        status: 'applied',
        summary: 'Memory written.',
      },
      toolName: 'writeMemory',
    },
  ],
  content: 'Runtime intent wrote one memory.',
  ideas: [],
  intents: [
    {
      confidence: 0.94,
      evidenceRefs: [intentPayload.evidenceRefs[0]],
      idempotencyKey: `${intentSourceId}:intent:memory`,
      intentType: 'memory',
      mode: 'reflection',
      rationale: 'The user gave a durable preference.',
      risk: 'low',
      urgency: 'immediate',
    },
  ],
  status: ReviewRunStatus.Completed,
  stepCount: 2,
  toolCalls: [
    {
      apiName: 'writeMemory',
      arguments: JSON.stringify({
        content: 'User prefers concise release summaries.',
        evidenceRefs: [intentPayload.evidenceRefs[0]],
        idempotencyKey: `${intentSourceId}:writeMemory:tool-call-1`,
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
        receiptId: 'runtime-memory-receipt',
        resourceId: 'memory-1',
        status: 'applied',
        summary: 'Memory written.',
      },
      toolName: 'writeMemory',
    },
  ],
} satisfies ExecuteSelfIterationResult;

const runtimeContext = {
  now: () => 100,
  runtimeState: {
    getGuardState: async () => ({}),
    touchGuardState: async () => ({}),
  },
  scopeKey: 'agent:agent-1',
} satisfies RuntimeProcessorContext;

const createIntentSource = (
  payload: Record<string, unknown> = intentPayload,
  sourceId = intentSourceId,
  sourceType = AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
): SourceAgentSelfFeedbackIntentDeclared =>
  createSource({
    payload,
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'topic:topic-1',
    sourceId,
    sourceType,
    timestamp: 100,
  }) as SourceAgentSelfFeedbackIntentDeclared;

const createDependencies = (
  overrides: Partial<CreateSelfFeedbackIntentSourceHandlerDependencies> = {},
): CreateSelfFeedbackIntentSourceHandlerDependencies => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  enrichEvidence: vi.fn(async () => ({
    evidenceRefs: [topicEvidence],
  })),
  executeSelfIteration: vi.fn(async () => runtimeResult),
  maxSteps: 3,
  model: 'gpt-test',
  modelRuntime: { chat: vi.fn() },
  tools: {} as never,
  writeReceipt: vi.fn(async () => {}),
  ...overrides,
});

describe('self-feedback intent source handler', () => {
  /**
   * @example
   * expect(deps.executeSelfIteration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'feedback' }));
   */
  it('runs self-iteration executor for declared intent and records intent metadata on receipts', async () => {
    const deps = createDependencies({ writeReceipts: vi.fn(async () => {}) });
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(deps.enrichEvidence).toHaveBeenCalledWith({
      action: 'write',
      agentId: 'agent-1',
      kind: 'memory',
      operationId: undefined,
      scopeId: 'topic-1',
      scopeType: 'topic',
      toolCallId: 'tool-call-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(deps.executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        context: expect.objectContaining({
          evidenceRefs: [intentPayload.evidenceRefs[0], topicEvidence],
          intent: expect.objectContaining({ summary: intentPayload.summary }),
          sourceId: intentSourceId,
        }),
        maxSteps: 3,
        mode: 'feedback',
        sourceId: intentSourceId,
        userId: 'user-1',
      }),
    );
    expect(deps.writeReceipts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: `${intentSourceId}:review-summary`,
        metadata: expect.objectContaining({
          selfIteration: expect.objectContaining({
            intents: runtimeResult.intents,
            mode: 'feedback',
            sourceId: intentSourceId,
            toolCallId: 'tool-call-1',
          }),
        }),
      }),
      expect.objectContaining({ id: `${intentSourceId}:writeMemory:tool-call-1:action` }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        plannedActionCount: 1,
        planSummary: 'Runtime intent wrote one memory.',
        status: ReviewRunStatus.Completed,
      }),
    );
  });

  /**
   * @example
   * expect(runtimeFactory.createRuntime).toHaveBeenCalledWith(expect.objectContaining({ enrichment }));
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
      executeSelfIteration: undefined,
      model: undefined,
      modelRuntime: undefined,
      runtimeFactory,
      tools: undefined,
      writeReceipts: vi.fn(async () => {}),
    });
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    await handler.handle(createIntentSource());

    expect(runtimeFactory.createRuntime).toHaveBeenCalledWith({
      enrichment: { evidenceRefs: [topicEvidence] },
      payload: expect.objectContaining(intentPayload),
      source: expect.objectContaining({ sourceId: intentSourceId }),
    });
    expect(executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSteps: 4,
        model: 'gpt-factory',
        modelRuntime,
        mode: 'feedback',
        tools,
      }),
    );
  });

  /**
   * @example
   * await handler.handle(operationSource);
   */
  it('validates operation-scoped source ids and forwards operation context', async () => {
    const deps = createDependencies();
    const handler = createSelfFeedbackIntentSourceHandler(deps);
    const operationSourceId =
      'self-feedback-intent:user-1:agent-1:operation:operation-1:tool-call-1';

    await handler.handle(
      createIntentSource(
        {
          ...intentPayload,
          operationId: 'operation-1',
        },
        operationSourceId,
      ),
    );

    expect(deps.enrichEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'operation-1',
        scopeId: 'operation-1',
        scopeType: 'operation',
        topicId: 'topic-1',
      }),
    );
    expect(deps.executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          sourceId: operationSourceId,
        }),
        sourceId: operationSourceId,
      }),
    );
  });

  /**
   * @example
   * expect(deps.writeReceipt).toHaveBeenCalledTimes(1);
   */
  it('keeps completed runs completed when receipt writing fails', async () => {
    const receiptError = new Error('receipt store unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = createDependencies({
      writeReceipt: vi.fn(async () => {
        throw receiptError;
      }),
    });
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ status: ReviewRunStatus.Completed }),
        status: ReviewRunStatus.Completed,
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[AgentSignal] Failed to write self-feedback intent receipt:',
      receiptError,
    );
    consoleError.mockRestore();
  });

  /**
   * @example
   * expect(result.reason).toBe('invalid_payload');
   */
  it('requires the service-emitted tool call id for stable source verification', async () => {
    const deps = createDependencies();
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(
      createIntentSource({
        ...intentPayload,
        toolCallId: undefined,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.executeSelfIteration).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.status).toBe('skipped');
   */
  it('skips without enrichment or execution when the review gate is disabled', async () => {
    const deps = createDependencies({
      canRunReview: vi.fn(async () => false),
    });
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'gate_disabled',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.enrichEvidence).not.toHaveBeenCalled();
    expect(deps.executeSelfIteration).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.status).toBe('deduped');
   */
  it('dedupes without enrichment or execution when the declaration guard already exists', async () => {
    const deps = createDependencies({
      acquireReviewGuard: vi.fn(async () => false),
    });
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        guardKey: intentSourceId,
        status: ReviewRunStatus.Deduped,
      }),
    );
    expect(deps.enrichEvidence).not.toHaveBeenCalled();
    expect(deps.executeSelfIteration).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.reason).toBe('invalid_payload');
   */
  it('returns skipped invalid when source id does not match the expected declaration key', async () => {
    const deps = createDependencies();
    const handler = createSelfFeedbackIntentSourceHandler(deps);

    const result = await handler.handle(
      createIntentSource(intentPayload, 'self-feedback-intent:wrong'),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        sourceId: 'self-feedback-intent:wrong',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.executeSelfIteration).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(sourceHandlers[0].listen).toBe('agent.self_feedback_intent.declared');
   */
  it('installs an optional self-feedback intent source policy through default policy composition', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const deps = createDependencies();
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in shared registration test.',
            result: 'neutral',
          }),
        },
      },
      selfFeedbackIntent: deps,
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

    const selfFeedbackIntentHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
    );

    expect(selfFeedbackIntentHandler).toEqual(
      expect.objectContaining({
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared}:shared-review`,
        type: 'source',
      }),
    );

    const runtimeResult = await selfFeedbackIntentHandler?.handle(
      createIntentSource(),
      runtimeContext,
    );

    expect(runtimeResult).toEqual(
      expect.objectContaining({
        concluded: expect.objectContaining({ status: ReviewRunStatus.Completed }),
        status: 'conclude',
      }),
    );
  });
});

describe('self-feedback intent source policy handler', () => {
  /**
   * @example
   * expect(handler.listen).toBe('agent.self_feedback_intent.declared');
   */
  it('listens to the self-feedback intent declared source type', () => {
    const handler = createSelfFeedbackIntentSourcePolicyHandler(createDependencies());

    expect(handler.listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared);
  });
});
