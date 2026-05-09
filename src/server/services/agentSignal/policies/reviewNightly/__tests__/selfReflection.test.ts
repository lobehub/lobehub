// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfReflectionRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import type {
  AgentSignalActionHandlerDefinition,
  AgentSignalSignalHandlerDefinition,
  AgentSignalSourceHandlerDefinition,
} from '../../../runtime/middleware';
import type {
  MaintenancePlan,
  MaintenancePlanDraft,
  MaintenanceReviewRunResult,
} from '../../../services/maintenance/types';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
  ReviewRunStatus,
} from '../../../services/maintenance/types';
import { createDefaultAgentSignalPolicies } from '../..';
import type {
  CreateSelfReflectionSourceHandlerDependencies,
  SelfReflectionReviewContext,
} from '../selfReflection';
import {
  createSelfReflectionSourceHandler,
  createSelfReflectionSourcePolicyHandler,
} from '../selfReflection';

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

const reflectionDraft = {
  actions: [
    {
      actionType: 'write_memory',
      confidence: 0.9,
      evidenceRefs: [{ id: 'task-1', type: 'task' }],
      rationale: 'The task exposed a durable preference.',
      value: { content: 'User prefers scoped task follow-up.' },
    },
  ],
  findings: [],
  summary: 'Task-scoped reflection found one durable preference.',
} satisfies MaintenancePlanDraft;

const reflectionPlan = {
  actions: [
    {
      actionType: 'write_memory',
      applyMode: MaintenanceApplyMode.AutoApply,
      confidence: 0.9,
      dedupeKey: 'memory:User prefers scoped task follow-up.',
      evidenceRefs: [{ id: 'task-1', type: 'task' }],
      idempotencyKey: `${reflectionSourceId}:write_memory:memory:User prefers scoped task follow-up.`,
      operation: {
        domain: 'memory',
        input: { content: 'User prefers scoped task follow-up.', userId: 'user-1' },
        operation: 'write',
      },
      rationale: 'The task exposed a durable preference.',
      risk: MaintenanceRisk.Low,
    },
  ],
  plannerVersion: 'test-planner',
  reviewScope: MaintenanceReviewScope.SelfReflection,
  summary: 'Task-scoped reflection found one durable preference.',
} satisfies MaintenancePlan;

const executionResult = {
  actions: [
    {
      idempotencyKey: `${reflectionSourceId}:write_memory:memory:User prefers scoped task follow-up.`,
      receiptId: 'receipt-1',
      status: MaintenanceActionStatus.Applied,
      summary: 'Memory written.',
    },
  ],
  status: ReviewRunStatus.Completed,
} satisfies MaintenanceReviewRunResult;

const createDependencies = (
  overrides: Partial<CreateSelfReflectionSourceHandlerDependencies> = {},
): CreateSelfReflectionSourceHandlerDependencies => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  collectContext: vi.fn(async () => reflectionContext),
  executePlan: vi.fn(async () => executionResult),
  planReviewOutput: vi.fn(async () => reflectionPlan),
  runMaintenanceReviewAgent: vi.fn(async () => reflectionDraft),
  writeReceipt: vi.fn(async () => {}),
  ...overrides,
});

describe('self-reflection source handler', () => {
  /**
   * @example
   * expect(result.status).toBe('completed');
   */
  it('orchestrates scoped collector reviewer planner executor and receipt writer', async () => {
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
    expect(deps.runMaintenanceReviewAgent).toHaveBeenCalledWith(reflectionContext);
    expect(deps.planReviewOutput).toHaveBeenCalledWith({
      draft: reflectionDraft,
      reviewScope: MaintenanceReviewScope.SelfReflection,
      sourceId: reflectionSourceId,
      userId: 'user-1',
    });
    expect(deps.executePlan).toHaveBeenCalledWith(reflectionPlan);
    expect(deps.writeReceipt).toHaveBeenCalledWith({
      execution: expect.objectContaining({
        status: executionResult.status,
        summaryReceiptId: `${reflectionSourceId}:review-summary`,
      }),
      plan: reflectionPlan,
      reason: 'failed_tool_count',
      scopeId: 'task-1',
      scopeType: 'task',
      sourceId: reflectionSourceId,
    });
    expect(result).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        execution: expect.objectContaining({ status: executionResult.status }),
        plannedActionCount: 1,
        planSummary: 'Task-scoped reflection found one durable preference.',
        sourceId: reflectionSourceId,
        status: ReviewRunStatus.Completed,
        userId: 'user-1',
      }),
    );
  });

  /**
   * @example
   * expect(executedPlan.actions[0].applyMode).toBe('proposal_only');
   */
  it('passes SelfReflection scope so consolidate skill drafts stay proposal-only', async () => {
    const consolidateDraft = {
      actions: [
        {
          actionType: 'consolidate_skill',
          confidence: 0.99,
          evidenceRefs: [
            { id: 'skill-a', type: 'agent_document' },
            { id: 'skill-b', type: 'agent_document' },
          ],
          rationale: 'Two managed skills overlap.',
          target: { skillDocumentId: 'skill-a' },
          value: { sourceSkillIds: ['skill-a', 'skill-b'] },
        },
      ],
      findings: [],
      summary: 'Overlap found.',
    } satisfies MaintenancePlanDraft;
    const proposalOnlyPlan = {
      actions: [
        {
          actionType: 'consolidate_skill',
          applyMode: MaintenanceApplyMode.ProposalOnly,
          confidence: 0.99,
          dedupeKey: 'skill:skill-a',
          evidenceRefs: [
            { id: 'skill-a', type: 'agent_document' },
            { id: 'skill-b', type: 'agent_document' },
          ],
          idempotencyKey: `${reflectionSourceId}:consolidate_skill:skill:skill-a`,
          operation: {
            domain: 'skill',
            input: {
              canonicalSkillDocumentId: 'skill-a',
              sourceSkillIds: ['skill-a', 'skill-b'],
              userId: 'user-1',
            },
            operation: 'consolidate',
          },
          rationale: 'Two managed skills overlap.',
          risk: MaintenanceRisk.High,
          target: { skillDocumentId: 'skill-a' },
        },
      ],
      plannerVersion: 'test-planner',
      reviewScope: MaintenanceReviewScope.SelfReflection,
      summary: 'Overlap found.',
    } satisfies MaintenancePlan;
    const deps = createDependencies({
      executePlan: vi.fn(async () => ({
        actions: [
          {
            idempotencyKey: `${reflectionSourceId}:consolidate_skill:skill:skill-a`,
            status: MaintenanceActionStatus.Proposed,
            summary: 'Two managed skills overlap.',
          },
        ],
        status: ReviewRunStatus.Completed,
      })),
      planReviewOutput: vi.fn(async () => proposalOnlyPlan),
      runMaintenanceReviewAgent: vi.fn(async () => consolidateDraft),
    });
    const handler = createSelfReflectionSourceHandler(deps);

    await handler.handle(createReflectionSource());

    expect(deps.planReviewOutput).toHaveBeenCalledWith({
      draft: consolidateDraft,
      reviewScope: MaintenanceReviewScope.SelfReflection,
      sourceId: reflectionSourceId,
      userId: 'user-1',
    });
    expect(deps.executePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'consolidate_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
          }),
        ],
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

    expect(deps.writeReceipts).toHaveBeenCalledWith([
      expect.objectContaining({ id: `${reflectionSourceId}:review-summary` }),
      expect.objectContaining({
        id: `${reflectionSourceId}:write_memory:memory:User prefers scoped task follow-up.:action`,
      }),
    ]);
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

    expect(deps.executePlan).toHaveBeenCalledWith(reflectionPlan);
    expect(result).toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ status: executionResult.status }),
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
    expect(deps.runMaintenanceReviewAgent).not.toHaveBeenCalled();
    expect(deps.executePlan).not.toHaveBeenCalled();
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
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested}:maintenance-review`,
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
