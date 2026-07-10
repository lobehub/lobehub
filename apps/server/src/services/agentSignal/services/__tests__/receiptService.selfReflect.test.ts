// @vitest-environment node
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it } from 'vitest';

import { createReviewSummaryReceipt, createSelfReviewActionReceipt } from '../receiptService';
import type { ActionResult, Plan } from '../selfIteration/types';
import { ActionStatus, ApplyMode, ReviewRunStatus, Risk, Scope } from '../selfIteration/types';

const nightlyPlan = {
  actions: [
    {
      actionType: 'write_memory',
      applyMode: ApplyMode.AutoApply,
      confidence: 0.93,
      dedupeKey: 'memory:concise',
      evidenceRefs: [{ id: 'topic-1', summary: 'User prefers concise summaries.', type: 'topic' }],
      idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:write_memory:memory:concise',
      operation: {
        domain: 'memory',
        input: { content: 'User prefers concise summaries.', userId: 'user-1' },
        operation: 'write',
      },
      rationale: 'Stable preference found in the review window.',
      risk: Risk.Low,
      target: { topicIds: ['topic-1'] },
    },
  ],
  localDate: '2026-05-04',
  plannerVersion: 'test-planner',
  reviewScope: Scope.Nightly,
  summary: 'Saved one stable preference.',
} satisfies Plan;

const actionResult = {
  idempotencyKey: 'nightly-review:user-1:agent-1:2026-05-04:write_memory:memory:concise',
  receiptId: 'receipt-action-1',
  resourceId: 'memory-1',
  status: ActionStatus.Applied,
  summary: 'Memory written.',
} satisfies ActionResult;

describe('createReviewSummaryReceipt', () => {
  /**
   * @example
   * A completed nightly review produces one source-level audit receipt.
   */
  it('projects one summary receipt for completed nightly reviews', () => {
    const receipt = createReviewSummaryReceipt({
      agentId: 'agent-1',
      createdAt: 1_700_000,
      localDate: '2026-05-04',
      plan: nightlyPlan,
      result: {
        actions: [actionResult],
        sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
        status: ReviewRunStatus.Completed,
      },
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(receipt).toMatchObject({
      agentId: 'agent-1',
      id: 'nightly-review:user-1:agent-1:2026-05-04:review-summary',
      kind: 'review',
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      topicId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });
    expect(receipt.metadata).toMatchObject({
      actionCount: 1,
      localDate: '2026-05-04',
      reviewScope: Scope.Nightly,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      timezone: 'Asia/Shanghai',
    });
  });

  /**
   * @example
   * A topic-scoped self-reflection receipt remains indexed by the original topic.
   */
  it('keeps self-reflection receipts topic local when a topic id is available', () => {
    const receipt = createReviewSummaryReceipt({
      agentId: 'agent-1',
      createdAt: 1_700_000,
      plan: { ...nightlyPlan, reviewScope: Scope.SelfReflection },
      result: { actions: [actionResult], status: ReviewRunStatus.Completed },
      scopeId: 'topic-1',
      scopeType: 'topic',
      sourceId: 'self-reflection:user-1:agent-1:topic:topic-1:receipt_count:window',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(receipt.topicId).toBe('topic-1');
    expect(receipt.metadata).toMatchObject({
      reviewScope: Scope.SelfReflection,
      scopeId: 'topic-1',
      scopeType: 'topic',
    });
  });
});

describe('createSelfReviewActionReceipt', () => {
  /**
   * @example
   * Applied and proposed self-review actions become durable action receipts.
   */
  it('projects applied self-review actions with action metadata and target resource', () => {
    const receipt = createSelfReviewActionReceipt({
      action: nightlyPlan.actions[0],
      agentId: 'agent-1',
      createdAt: 1_700_001,
      localDate: '2026-05-04',
      result: actionResult,
      reviewScope: Scope.Nightly,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(receipt).toMatchObject({
      id: 'nightly-review:user-1:agent-1:2026-05-04:write_memory:memory:concise:action',
      kind: 'memory',
      status: 'applied',
      target: {
        id: 'memory-1',
        summary: 'Memory written.',
        title: 'Memory written.',
        type: 'memory',
      },
    });
    expect(receipt?.metadata).toMatchObject({
      actionStatus: ActionStatus.Applied,
      actionType: 'write_memory',
      localDate: '2026-05-04',
      reviewScope: Scope.Nightly,
    });
  });

  /**
   * @example
   * Skipped self-review actions do not create action receipts.
   */
  it('does not project skipped action receipts', () => {
    expect(
      createSelfReviewActionReceipt({
        action: nightlyPlan.actions[0],
        agentId: 'agent-1',
        result: {
          idempotencyKey: actionResult.idempotencyKey,
          status: ActionStatus.Skipped,
        },
        reviewScope: Scope.Nightly,
        sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
        userId: 'user-1',
      }),
    ).toBeUndefined();
  });
});
