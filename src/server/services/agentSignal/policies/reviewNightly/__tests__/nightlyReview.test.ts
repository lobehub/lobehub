// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentNightlyReviewRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';

import type {
  AgentSignalActionHandlerDefinition,
  AgentSignalSignalHandlerDefinition,
  AgentSignalSourceHandlerDefinition,
} from '../../../runtime/middleware';
import type { MaintenanceAgentRunResult } from '../../../services/maintenance/agentRunner';
import type { NightlyReviewContext } from '../../../services/maintenance/nightlyCollector';
import type {
  MaintenancePlan,
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
import type { CreateNightlyReviewSourceHandlerDependencies } from '../nightlyReview';
import {
  createNightlyReviewSourceHandler,
  createNightlyReviewSourcePolicyHandler,
} from '../nightlyReview';

const reviewPayload = {
  agentId: 'agent-1',
  localDate: '2026-05-04',
  requestedAt: '2026-05-04T14:00:00.000Z',
  reviewWindowEnd: '2026-05-04T14:00:00.000Z',
  reviewWindowStart: '2026-05-03T14:00:00.000Z',
  timezone: 'Asia/Shanghai',
  userId: 'user-1',
};

const createReviewSource = (
  payload: Record<string, unknown> = reviewPayload,
  sourceType = AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
): SourceAgentNightlyReviewRequested =>
  createSource({
    payload,
    scope: { agentId: 'agent-1', userId: 'user-1' },
    scopeKey: 'agent:agent-1',
    sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
    sourceType,
    timestamp: 100,
  }) as SourceAgentNightlyReviewRequested;

const reviewContext = {
  agentId: 'agent-1',
  documentActivity: {
    ambiguousBucket: [],
    excludedSummary: { count: 0, reasons: [] },
    generalDocumentBucket: [],
    skillBucket: [],
  },
  feedbackActivity: {
    neutralCount: 0,
    notSatisfied: [],
    satisfied: [],
  },
  maintenanceSignals: [],
  managedSkills: [],
  proposalActivity: {
    active: [],
    dismissedCount: 0,
    expiredCount: 0,
    staleCount: 0,
    supersededCount: 0,
  },
  receiptActivity: {
    appliedCount: 0,
    duplicateGroups: [],
    failedCount: 0,
    pendingProposalCount: 0,
    recentReceipts: [],
    reviewCount: 0,
  },
  relevantMemories: [],
  reviewWindowEnd: reviewPayload.reviewWindowEnd,
  reviewWindowStart: reviewPayload.reviewWindowStart,
  toolActivity: [],
  topics: [],
  userId: 'user-1',
} satisfies NightlyReviewContext;

const reviewPlan = {
  actions: [
    {
      actionType: 'noop',
      applyMode: MaintenanceApplyMode.Skip,
      confidence: 0.9,
      dedupeKey: 'noop:quiet',
      evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
      idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:noop:quiet',
      rationale: 'No maintenance needed.',
      risk: MaintenanceRisk.Low,
    },
  ],
  localDate: reviewPayload.localDate,
  plannerVersion: 'test-planner',
  reviewScope: MaintenanceReviewScope.Nightly,
  summary: 'Quiet night.',
} satisfies MaintenancePlan;

const executionResult = {
  actions: [
    {
      idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:noop:quiet',
      status: MaintenanceActionStatus.Skipped,
      summary: 'No maintenance needed.',
    },
  ],
  status: ReviewRunStatus.Completed,
} satisfies MaintenanceReviewRunResult;

const reviewAgentResult = {
  execution: executionResult,
  projectionPlan: reviewPlan,
  stepCount: 1,
} satisfies MaintenanceAgentRunResult;

const createDependencies = (
  overrides: Partial<CreateNightlyReviewSourceHandlerDependencies> = {},
): CreateNightlyReviewSourceHandlerDependencies => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  collectContext: vi.fn(async () => reviewContext),
  runMaintenanceReviewAgent: vi.fn(async () => reviewAgentResult),
  ...overrides,
});

describe('nightly review source handler', () => {
  /**
   * @example
   * expect(result.status).toBe('completed');
   */
  it('orchestrates collector and bounded agent runner for a valid nightly source', async () => {
    const deps = createDependencies();
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(deps.canRunReview).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        guardKey: 'nightly-review:user-1:agent-1:2026-05-04',
        localDate: '2026-05-04',
        userId: 'user-1',
      }),
    );
    expect(deps.acquireReviewGuard).toHaveBeenCalledWith(
      expect.objectContaining({ guardKey: 'nightly-review:user-1:agent-1:2026-05-04' }),
    );
    expect(deps.collectContext).toHaveBeenCalledWith({
      agentId: 'agent-1',
      reviewWindowEnd: reviewPayload.reviewWindowEnd,
      reviewWindowStart: reviewPayload.reviewWindowStart,
      userId: 'user-1',
    });
    expect(deps.runMaintenanceReviewAgent).toHaveBeenCalledWith({
      context: reviewContext,
      localDate: '2026-05-04',
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });
    expect(result).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        execution: expect.objectContaining({ status: executionResult.status }),
        plannedActionCount: 1,
        planSummary: 'Quiet night.',
        sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
        status: ReviewRunStatus.Completed,
        userId: 'user-1',
      }),
    );
  });

  /**
   * @example
   * expect(deps.writeReceipts).toHaveBeenCalledBefore(deps.writeDailyBrief).
   */
  it('writes review receipts before creating an eligible nightly brief', async () => {
    const calls: string[] = [];
    const deps = createDependencies({
      runMaintenanceReviewAgent: vi.fn(async () => ({
        execution: {
          actions: [
            {
              idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:proposal_only:skill-doc-1',
              status: MaintenanceActionStatus.Proposed,
              summary: 'Review the skill consolidation proposal.',
            },
          ],
          status: ReviewRunStatus.Completed,
        },
        projectionPlan: {
          ...reviewPlan,
          actions: [
            {
              ...reviewPlan.actions[0],
              actionType: 'proposal_only',
              applyMode: MaintenanceApplyMode.ProposalOnly,
              dedupeKey: 'proposal_only:skill-doc-1',
              idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:proposal_only:skill-doc-1',
              rationale: 'Review the skill consolidation proposal.',
              risk: MaintenanceRisk.Medium,
            },
          ],
        } satisfies MaintenancePlan,
      })),
      writeDailyBrief: vi.fn(async () => {
        calls.push('brief');

        return { id: 'brief-1' };
      }),
      writeReceipts: vi.fn(async () => {
        calls.push('receipts');
      }),
    });
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(calls).toEqual(['receipts', 'brief']);
    expect(deps.writeReceipts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'nightly-review:user-1:agent-1:2026-05-04:review-summary' }),
      expect.objectContaining({
        id: 'nightly-review:user-1:agent-1:2026-05-04:proposal_only:skill-doc-1:action',
      }),
    ]);
    expect(deps.writeDailyBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        metadata: expect.objectContaining({
          evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
        }),
        trigger: 'agent-signal:nightly-review',
        type: 'decision',
      }),
    );
    expect(result.execution).toEqual(
      expect.objectContaining({
        briefId: 'brief-1',
        summaryReceiptId: 'nightly-review:user-1:agent-1:2026-05-04:review-summary',
      }),
    );
  });

  /**
   * @example
   * expect(deps.writeDailyBrief).toHaveBeenCalledWith(expect.objectContaining({ type: 'insight' }));
   */
  it('creates an insight brief for auto-applied nightly maintenance', async () => {
    const deps = createDependencies({
      runMaintenanceReviewAgent: vi.fn(async () => ({
        execution: {
          actions: [
            {
              idempotencyKey:
                'nightly-review:user-1:agent-1:2026-05-04:write_memory:memory:concise',
              resourceId: 'mem-1',
              status: MaintenanceActionStatus.Applied,
              summary: 'Saved concise release summary preference.',
            },
          ],
          status: ReviewRunStatus.Completed,
        },
        projectionPlan: {
          ...reviewPlan,
          actions: [
            {
              ...reviewPlan.actions[0],
              actionType: 'write_memory',
              applyMode: MaintenanceApplyMode.AutoApply,
              dedupeKey: 'memory:concise',
              idempotencyKey:
                'nightly-review:user-1:agent-1:2026-05-04:write_memory:memory:concise',
              operation: {
                domain: 'memory',
                input: {
                  content: 'User prefers concise release summaries.',
                  userId: 'user-1',
                },
                operation: 'write',
              },
              rationale: 'The user stated a durable release summary preference.',
              risk: MaintenanceRisk.Low,
              target: { topicIds: ['topic-1'] },
            },
          ],
        } satisfies MaintenancePlan,
      })),
      writeDailyBrief: vi.fn(async () => ({ id: 'brief-insight-1' })),
      writeReceipts: vi.fn(async () => {}),
    });
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(deps.writeReceipts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'nightly-review:user-1:agent-1:2026-05-04:review-summary' }),
      expect.objectContaining({
        id: 'nightly-review:user-1:agent-1:2026-05-04:write_memory:memory:concise:action',
      }),
    ]);
    expect(deps.writeDailyBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          actionCounts: { applied: 1, failed: 0, proposed: 0, skipped: 0 },
          outcome: 'applied',
        }),
        title: 'Agent self-review updated resources',
        trigger: 'agent-signal:nightly-review',
        type: 'insight',
      }),
    );
    expect(result.execution).toEqual(
      expect.objectContaining({
        briefId: 'brief-insight-1',
      }),
    );
  });

  /**
   * @example
   * expect(deps.writeDailyBrief).not.toHaveBeenCalled();
   */
  it('keeps skipped noop reviews silent after writing the summary receipt', async () => {
    const deps = createDependencies({
      writeDailyBrief: vi.fn(async () => ({ id: 'brief-1' })),
      writeReceipts: vi.fn(async () => {}),
    });
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(deps.writeReceipts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'nightly-review:user-1:agent-1:2026-05-04:review-summary' }),
    ]);
    expect(deps.writeDailyBrief).not.toHaveBeenCalled();
    expect(result.execution).toEqual(
      expect.not.objectContaining({
        briefId: expect.any(String),
      }),
    );
  });

  /**
   * @example
   * expect(brief.metadata.proposal.actions[0].operation).toBeDefined();
   */
  it('projects frozen proposal action operations from the runner projection plan', async () => {
    const proposedSkillPlan = {
      ...reviewPlan,
      actions: [
        {
          ...reviewPlan.actions[0],
          actionType: 'refine_skill',
          dedupeKey: 'refine_skill:skill-doc-1',
          idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:refine_skill:skill-doc-1',
          operation: {
            domain: 'skill',
            input: {
              patch: 'Use the newer workflow summary wording.',
              skillDocumentId: 'skill-doc-1',
              userId: 'user-1',
            },
            operation: 'refine',
          },
          target: { skillDocumentId: 'skill-doc-1' },
        },
      ],
    } satisfies MaintenancePlan;
    const deps = createDependencies({
      runMaintenanceReviewAgent: vi.fn(async () => ({
        execution: {
          actions: [
            {
              idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:refine_skill:skill-doc-1',
              status: MaintenanceActionStatus.Proposed,
              summary: 'Refine the workflow summary skill.',
            },
          ],
          status: ReviewRunStatus.Completed,
        },
        projectionPlan: proposedSkillPlan,
      })),
      writeDailyBrief: vi.fn(async () => ({ id: 'brief-1' })),
      writeReceipts: vi.fn(async () => {}),
    });
    const handler = createNightlyReviewSourceHandler(deps);

    await handler.handle(createReviewSource());

    expect(deps.writeDailyBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          proposal: expect.objectContaining({
            actions: [
              expect.objectContaining({
                actionType: 'refine_skill',
                operation: expect.objectContaining({
                  domain: 'skill',
                  operation: 'refine',
                }),
              }),
            ],
          }),
        }),
      }),
    );
  });

  /**
   * @example
   * expect(result.briefWriteFailed).toBe(true);
   */
  it('keeps nightly runs completed when brief creation fails after receipts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const briefError = new Error('brief store unavailable');
    const deps = createDependencies({
      runMaintenanceReviewAgent: vi.fn(async () => ({
        execution: {
          actions: [
            {
              idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:proposal_only:skill-doc-1',
              status: MaintenanceActionStatus.Proposed,
              summary: 'Review the skill consolidation proposal.',
            },
          ],
          status: ReviewRunStatus.Completed,
        },
        projectionPlan: {
          ...reviewPlan,
          actions: [
            {
              ...reviewPlan.actions[0],
              actionType: 'proposal_only',
              applyMode: MaintenanceApplyMode.ProposalOnly,
              dedupeKey: 'proposal_only:skill-doc-1',
              idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:proposal_only:skill-doc-1',
              rationale: 'Review the skill consolidation proposal.',
              risk: MaintenanceRisk.Medium,
            },
          ],
        } satisfies MaintenancePlan,
      })),
      writeDailyBrief: vi.fn(async () => {
        throw briefError;
      }),
      writeReceipts: vi.fn(async () => {}),
    });
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(result).toEqual(
      expect.objectContaining({
        briefWriteFailed: true,
        status: ReviewRunStatus.Completed,
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[AgentSignal] Failed to write nightly review brief:',
      briefError,
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
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(result).toEqual(
      expect.objectContaining({
        guardKey: 'nightly-review:user-1:agent-1:2026-05-04',
        status: ReviewRunStatus.Deduped,
      }),
    );
    expect(deps.collectContext).not.toHaveBeenCalled();
    expect(deps.runMaintenanceReviewAgent).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.reason).toBe('gate_disabled');
   */
  it('returns skipped without acquiring the guard when gates reject the review', async () => {
    const deps = createDependencies({
      canRunReview: vi.fn(async () => false),
    });
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

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
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(
      createReviewSource({ agentId: 'agent-1', userId: 'user-1' }),
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
  it('returns skipped invalid when source id does not match the nightly guard key', async () => {
    const deps = createDependencies();
    const handler = createNightlyReviewSourceHandler(deps);

    const mismatchedSource = {
      ...createReviewSource(),
      sourceId: 'nightly-review:user-1:agent-1:wrong-date',
    } satisfies SourceAgentNightlyReviewRequested;
    const mismatchedResult = await handler.handle(mismatchedSource);

    expect(mismatchedResult).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        sourceId: 'nightly-review:user-1:agent-1:wrong-date',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.acquireReviewGuard).not.toHaveBeenCalled();
    expect(deps.collectContext).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(sourceHandlers[0].listen).toBe('agent.nightly_review.requested');
   */
  it('installs an optional nightly source policy through default policy composition', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const deps = createDependencies();
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in nightly registration test.',
            result: 'neutral',
          }),
        },
      },
      nightlyReview: deps,
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

    const nightlyHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
    );

    expect(nightlyHandler).toEqual(
      expect.objectContaining({
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested}:maintenance-review`,
        type: 'source',
      }),
    );

    const runtimeResult = await nightlyHandler?.handle(createReviewSource(), {
      now: () => 100,
      scopeKey: 'agent:agent-1',
    } as never);

    expect(runtimeResult).toEqual(
      expect.objectContaining({
        concluded: expect.objectContaining({ status: ReviewRunStatus.Completed }),
        status: 'conclude',
      }),
    );
  });

  /**
   * @example
   * expect(nightlyHandler).toBeUndefined();
   */
  it('does not install nightly source handlers without nightly review dependencies', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in nightly registration test.',
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

    const nightlyHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
    );

    expect(nightlyHandler).toBeUndefined();
  });
});

describe('nightly review source policy handler', () => {
  /**
   * @example
   * expect(handler.listen).toBe('agent.nightly_review.requested');
   */
  it('listens to the nightly review requested source type', () => {
    const handler = createNightlyReviewSourcePolicyHandler(createDependencies());

    expect(handler.listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested);
  });
});
