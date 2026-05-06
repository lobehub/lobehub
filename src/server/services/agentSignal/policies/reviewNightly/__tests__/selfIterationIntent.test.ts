// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentSelfIterationIntentDeclared } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import type {
  AgentSignalActionHandlerDefinition,
  AgentSignalSignalHandlerDefinition,
  AgentSignalSourceHandlerDefinition,
} from '../../../runtime/middleware';
import { createMaintenancePlannerService } from '../../../services/maintenance/planner';
import type { EvidenceRef, MaintenancePlan } from '../../../services/maintenance/types';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  ReviewRunStatus,
} from '../../../services/maintenance/types';
import { createDefaultAgentSignalPolicies } from '../..';
import type { CreateSelfIterationIntentSourceHandlerDependencies } from '../selfIterationIntent';
import {
  createSelfIterationIntentSourceHandler,
  createSelfIterationIntentSourcePolicyHandler,
} from '../selfIterationIntent';

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

const intentSourceId = 'self-iteration-intent:user-1:agent-1:topic:topic-1:tool-call-1';

const topicEvidence = {
  id: 'topic-1',
  summary: 'Current topic context.',
  type: 'topic',
} satisfies EvidenceRef;

const conflictEvidence = {
  id: 'msg-stop',
  summary: 'User said do not remember this.',
  type: 'message',
} satisfies EvidenceRef;

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
  sourceType = AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared,
): SourceAgentSelfIterationIntentDeclared =>
  createSource({
    payload,
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'topic:topic-1',
    sourceId,
    sourceType,
    timestamp: 100,
  }) as SourceAgentSelfIterationIntentDeclared;

const createDependencies = (
  overrides: Partial<CreateSelfIterationIntentSourceHandlerDependencies> = {},
): CreateSelfIterationIntentSourceHandlerDependencies => {
  const planner = createMaintenancePlannerService({ plannerVersion: 'test-planner' });

  return {
    acquireReviewGuard: vi.fn(async () => true),
    canRunReview: vi.fn(async () => true),
    enrichEvidence: vi.fn(async () => ({
      evidenceRefs: [topicEvidence],
    })),
    executePlan: vi.fn(async (plan: MaintenancePlan) => ({
      actions: plan.actions.map((action) => ({
        idempotencyKey: action.idempotencyKey,
        status:
          action.applyMode === MaintenanceApplyMode.AutoApply
            ? MaintenanceActionStatus.Applied
            : action.applyMode === MaintenanceApplyMode.ProposalOnly
              ? MaintenanceActionStatus.Proposed
              : MaintenanceActionStatus.Skipped,
        summary: action.rationale,
      })),
      status: ReviewRunStatus.Completed,
    })),
    planReviewOutput: vi.fn((request) => planner.plan(request)),
    writeReceipt: vi.fn(async () => {}),
    ...overrides,
  };
};

describe('self-iteration intent source handler', () => {
  /**
   * @example
   * expect(executedPlan.actions[0].applyMode).toBe('auto_apply');
   */
  it('lets strong evidence memory intent become auto-apply through the planner', async () => {
    const deps = createDependencies();
    const handler = createSelfIterationIntentSourceHandler(deps);

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
    expect(deps.planReviewOutput).toHaveBeenCalledWith({
      draft: {
        actions: [
          expect.objectContaining({
            actionType: 'write_memory',
            confidence: 0.94,
            evidenceRefs: [
              intentPayload.evidenceRefs[0],
              { id: 'topic-1', summary: 'Current topic context.', type: 'topic' },
            ],
            target: { topicIds: ['topic-1'] },
            value: {
              content: 'User prefers concise release summaries.',
              reason: 'The user gave a durable preference.',
              userId: 'user-1',
            },
          }),
        ],
        findings: [],
        summary: 'User prefers concise release summaries.',
      },
      reviewScope: MaintenanceReviewScope.SelfIterationIntent,
      sourceId: intentSourceId,
      userId: 'user-1',
    });
    expect(deps.executePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'write_memory',
            applyMode: MaintenanceApplyMode.AutoApply,
            operation: expect.objectContaining({
              input: expect.objectContaining({
                content: 'User prefers concise release summaries.',
                userId: 'user-1',
              }),
            }),
          }),
        ],
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ status: ReviewRunStatus.Completed }),
        plannedActionCount: 1,
        planSummary: 'User prefers concise release summaries.',
        sourceId: intentSourceId,
        status: ReviewRunStatus.Completed,
      }),
    );
  });

  /**
   * @example
   * expect(executedPlan.actions[0].applyMode).toBe('skip');
   */
  it('skips evidence-poor memory intent through the real planner', async () => {
    const deps = createDependencies({
      enrichEvidence: vi.fn(async () => ({ evidenceRefs: [] })),
    });
    const handler = createSelfIterationIntentSourceHandler(deps);

    await handler.handle(
      createIntentSource({
        ...intentPayload,
        confidence: 0.78,
        evidenceRefs: [],
        summary: 'Maybe remember terse summaries.',
      }),
    );

    expect(deps.executePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'write_memory',
            applyMode: MaintenanceApplyMode.Skip,
          }),
        ],
      }),
    );
  });

  /**
   * @example
   * expect(executedPlan.actions[0].applyMode).toBe('proposal_only');
   */
  it('keeps high-risk consolidation intent proposal-only', async () => {
    const deps = createDependencies();
    const handler = createSelfIterationIntentSourceHandler(deps);

    await handler.handle(
      createIntentSource({
        ...intentPayload,
        action: 'consolidate',
        confidence: 0.99,
        evidenceRefs: [{ id: 'skill-1', type: 'agent_document' }],
        kind: 'skill',
        skillId: 'skill-1',
        summary: 'Merge overlapping planning skills.',
      }),
    );

    expect(deps.executePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'consolidate_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            operation: expect.objectContaining({
              input: expect.objectContaining({
                canonicalSkillDocumentId: 'skill-1',
                sourceSkillIds: ['skill-1'],
                userId: 'user-1',
              }),
            }),
            target: expect.objectContaining({ skillDocumentId: 'skill-1' }),
          }),
        ],
      }),
    );
  });

  /**
   * @example
   * expect(executedPlan.actions[0].actionType).toBe('proposal_only');
   */
  it('keeps skill refinement without a target skill id as proposal-only', async () => {
    const deps = createDependencies();
    const handler = createSelfIterationIntentSourceHandler(deps);

    await handler.handle(
      createIntentSource({
        ...intentPayload,
        action: 'refine',
        confidence: 0.96,
        evidenceRefs: [{ id: 'msg-2', type: 'message' }],
        kind: 'skill',
        summary: 'Refine an unspecified skill.',
      }),
    );

    expect(deps.executePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            actionType: 'proposal_only',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            operation: undefined,
          }),
        ],
      }),
    );
  });

  /**
   * @example
   * expect(executedPlan.actions[0].applyMode).toBe('skip');
   */
  it('skips intent that conflicts with explicit user instruction', async () => {
    const deps = createDependencies({
      enrichEvidence: vi.fn(async () => ({
        evidenceRefs: [conflictEvidence],
        hasUserInstructionConflict: true,
      })),
    });
    const handler = createSelfIterationIntentSourceHandler(deps);

    await handler.handle(createIntentSource());

    expect(deps.executePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            applyMode: MaintenanceApplyMode.Skip,
            confidence: 0,
            evidenceRefs: [],
            rationale: expect.stringContaining('explicit user instruction'),
          }),
        ],
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
    const handler = createSelfIterationIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ status: ReviewRunStatus.Completed }),
        status: ReviewRunStatus.Completed,
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[AgentSignal] Failed to write self-iteration intent receipt:',
      receiptError,
    );
    consoleError.mockRestore();
  });

  /**
   * @example
   * expect(deps.writeReceipts).toHaveBeenCalledWith(expect.arrayContaining([...])).
   */
  it('writes durable review and action receipts for declared intent runs', async () => {
    const deps = createDependencies({ writeReceipts: vi.fn(async () => {}) });
    const handler = createSelfIterationIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(deps.writeReceipts).toHaveBeenCalledWith([
      expect.objectContaining({ id: `${intentSourceId}:review-summary` }),
      expect.objectContaining({
        id: `${intentSourceId}:write_memory:memory:User prefers concise release summaries.:action`,
      }),
    ]);
    expect(result.execution).toEqual(
      expect.objectContaining({
        summaryReceiptId: `${intentSourceId}:review-summary`,
      }),
    );
  });

  /**
   * @example
   * expect(result.reason).toBe('invalid_payload');
   */
  it('requires the service-emitted tool call id for stable source verification', async () => {
    const deps = createDependencies();
    const handler = createSelfIterationIntentSourceHandler(deps);

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
    expect(deps.executePlan).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.status).toBe('skipped');
   */
  it('skips without enrichment or execution when the review gate is disabled', async () => {
    const deps = createDependencies({
      canRunReview: vi.fn(async () => false),
    });
    const handler = createSelfIterationIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'gate_disabled',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.enrichEvidence).not.toHaveBeenCalled();
    expect(deps.executePlan).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.status).toBe('deduped');
   */
  it('dedupes without enrichment or execution when the declaration guard already exists', async () => {
    const deps = createDependencies({
      acquireReviewGuard: vi.fn(async () => false),
    });
    const handler = createSelfIterationIntentSourceHandler(deps);

    const result = await handler.handle(createIntentSource());

    expect(result).toEqual(
      expect.objectContaining({
        guardKey: intentSourceId,
        status: ReviewRunStatus.Deduped,
      }),
    );
    expect(deps.enrichEvidence).not.toHaveBeenCalled();
    expect(deps.executePlan).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(deps.executePlan).toHaveBeenCalledWith(expect.objectContaining({ actions: expect.any(Array) }));
   */
  it('validates operation-scoped source ids and forwards operation context', async () => {
    const deps = createDependencies();
    const handler = createSelfIterationIntentSourceHandler(deps);
    const operationSourceId =
      'self-iteration-intent:user-1:agent-1:operation:operation-1:tool-call-1';

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
    expect(deps.executePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            idempotencyKey: expect.stringContaining(operationSourceId),
          }),
        ],
      }),
    );
  });

  /**
   * @example
   * expect(result.reason).toBe('invalid_payload');
   */
  it('returns skipped invalid when source id does not match the expected declaration key', async () => {
    const deps = createDependencies();
    const handler = createSelfIterationIntentSourceHandler(deps);

    const result = await handler.handle(
      createIntentSource(intentPayload, 'self-iteration-intent:wrong'),
    );

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        sourceId: 'self-iteration-intent:wrong',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.executePlan).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(sourceHandlers[0].listen).toBe('agent.self_iteration_intent.declared');
   */
  it('installs an optional self-iteration intent source policy through default policy composition', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const deps = createDependencies();
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in self-iteration registration test.',
            result: 'neutral',
          }),
        },
      },
      selfIterationIntent: deps,
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

    const selfIterationIntentHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared,
    );

    expect(selfIterationIntentHandler).toEqual(
      expect.objectContaining({
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared}:maintenance-review`,
        type: 'source',
      }),
    );

    const runtimeResult = await selfIterationIntentHandler?.handle(
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

describe('self-iteration intent source policy handler', () => {
  /**
   * @example
   * expect(handler.listen).toBe('agent.self_iteration_intent.declared');
   */
  it('listens to the self-iteration intent declared source type', () => {
    const handler = createSelfIterationIntentSourcePolicyHandler(createDependencies());

    expect(handler.listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared);
  });
});
