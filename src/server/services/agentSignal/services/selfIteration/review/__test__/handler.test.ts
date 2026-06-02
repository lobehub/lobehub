// @vitest-environment node
import { createSource } from '@lobechat/agent-signal';
import type { SourceAgentNightlyReviewRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultAgentSignalPolicies } from '../../../../policies';
import type {
  AgentSignalActionHandlerDefinition,
  AgentSignalSignalHandlerDefinition,
  AgentSignalSourceHandlerDefinition,
} from '../../../../runtime/middleware';
import { ReviewRunStatus } from '../../types';
import type { NightlyReviewContext } from '../collect';
import type { CreateNightlyReviewSourceHandlerDependencies } from '../handler';
import {
  createNightlyReviewSourceHandler,
  createNightlyReviewSourcePolicyHandler,
} from '../handler';

const reviewSourceId = 'nightly-review:user-1:agent-1:2026-05-04';

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
    sourceId: reviewSourceId,
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
  selfReviewSignals: [],
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
  selfFeedbackCandidates: [],
  toolActivity: [],
  topics: [],
  userId: 'user-1',
} satisfies NightlyReviewContext;

const createDependencies = (
  overrides: Partial<CreateNightlyReviewSourceHandlerDependencies> = {},
): CreateNightlyReviewSourceHandlerDependencies => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  collectContext: vi.fn(async () => reviewContext),
  db: {} as never,
  dispatch: vi.fn(async () => ({ operationId: 'op-nightly-1', topicId: 'tpc-nightly-1' })),
  ...overrides,
});

describe('nightly review source handler', () => {
  it('collects context then dispatches an async run under the builtin nightly-review slug', async () => {
    const deps = createDependencies();
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(deps.canRunReview).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        guardKey: reviewSourceId,
        localDate: '2026-05-04',
        userId: 'user-1',
      }),
    );
    expect(deps.acquireReviewGuard).toHaveBeenCalledWith(
      expect.objectContaining({ guardKey: reviewSourceId }),
    );
    expect(deps.collectContext).toHaveBeenCalledWith({
      agentId: 'agent-1',
      reviewWindowEnd: reviewPayload.reviewWindowEnd,
      reviewWindowStart: reviewPayload.reviewWindowStart,
      userId: 'user-1',
    });
    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        db: deps.db,
        // The review window + local date ride on the marker so the builtin
        // agent-signal-review serverRuntime can re-derive them.
        marker: {
          agentId: 'agent-1',
          kind: 'nightly-review',
          localDate: '2026-05-04',
          reviewWindowEnd: reviewPayload.reviewWindowEnd,
          reviewWindowStart: reviewPayload.reviewWindowStart,
          sourceId: reviewSourceId,
        },
        prompt: expect.stringContaining(reviewSourceId),
        slug: BUILTIN_AGENT_SLUGS.nightlyReview,
        userId: 'user-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        localDate: '2026-05-04',
        operationId: 'op-nightly-1',
        sourceId: reviewSourceId,
        status: ReviewRunStatus.Dispatched,
        userId: 'user-1',
      }),
    );
  });

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
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('returns deduped without collecting or dispatching when the review guard is held', async () => {
    const deps = createDependencies({
      acquireReviewGuard: vi.fn(async () => false),
    });
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource());

    expect(result).toEqual(
      expect.objectContaining({
        guardKey: reviewSourceId,
        status: ReviewRunStatus.Deduped,
      }),
    );
    expect(deps.collectContext).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('returns skipped invalid without throwing for invalid payloads', async () => {
    const deps = createDependencies();
    const handler = createNightlyReviewSourceHandler(deps);

    const result = await handler.handle(createReviewSource({ agentId: 'agent-1', userId: 'user-1' }));

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('returns skipped invalid when source id does not match the expected nightly key', async () => {
    const deps = createDependencies();
    const handler = createNightlyReviewSourceHandler(deps);

    const mismatchedSource = {
      ...createReviewSource(),
      sourceId: 'nightly-review:user-1:agent-1:wrong-date',
    } satisfies SourceAgentNightlyReviewRequested;
    const result = await handler.handle(mismatchedSource);

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'invalid_payload',
        sourceId: 'nightly-review:user-1:agent-1:wrong-date',
        status: ReviewRunStatus.Skipped,
      }),
    );
    expect(deps.canRunReview).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('installs an optional nightly review source policy through default policy composition', async () => {
    const sourceHandlers: AgentSignalSourceHandlerDefinition[] = [];
    const deps = createDependencies();
    const policies = createDefaultAgentSignalPolicies({
      feedbackSatisfactionJudge: {
        judge: {
          judgeSatisfaction: async () => ({
            confidence: 1,
            evidence: [],
            reason: 'No feedback in nightly review registration test.',
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

    const nightlyReviewHandler = sourceHandlers.find(
      (handler) => handler.listen === AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
    );

    expect(nightlyReviewHandler).toEqual(
      expect.objectContaining({
        id: `${AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested}:shared-review`,
        type: 'source',
      }),
    );

    const runtimeResult = await nightlyReviewHandler?.handle(createReviewSource(), {
      now: () => 100,
      runtimeState: {
        getGuardState: async () => ({}),
        touchGuardState: async () => ({}),
      },
      scopeKey: 'agent:agent-1',
    });

    expect(runtimeResult).toEqual(
      expect.objectContaining({
        concluded: expect.objectContaining({ status: ReviewRunStatus.Dispatched }),
        status: 'conclude',
      }),
    );
  });
});

describe('nightly review source policy handler', () => {
  it('listens to the nightly review requested source type', () => {
    const handler = createNightlyReviewSourcePolicyHandler(createDependencies());

    expect(handler.listen).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested);
  });
});
