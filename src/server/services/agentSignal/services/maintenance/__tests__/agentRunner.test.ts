// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { MaintenanceAgentRunResult } from '../agentRunner';
import { createMaintenanceAgentRunner } from '../agentRunner';
import type { NightlyReviewContext } from '../nightlyCollector';
import { createMaintenanceTools } from '../tools';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
  ReviewRunStatus,
} from '../types';

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
  reviewWindowEnd: '2026-05-04T14:00:00.000Z',
  reviewWindowStart: '2026-05-03T14:00:00.000Z',
  toolActivity: [],
  topics: [],
  userId: 'user-1',
} satisfies NightlyReviewContext;

const createNoopTools = () =>
  createMaintenanceTools({
    reserveOperation: vi.fn(async () => ({ reserved: true as const })),
    writeReceipt: vi.fn(async () => ({ receiptId: 'receipt-1' })),
  });

describe('createMaintenanceAgentRunner', () => {
  /**
   * @example
   * expect(result.projectionPlan.actions).toHaveLength(1);
   */
  it('passes source metadata, max steps, and tools into the backend runner', async () => {
    const tools = createNoopTools();
    const run = vi.fn<() => Promise<MaintenanceAgentRunResult>>(async () => ({
      execution: {
        actions: [
          {
            idempotencyKey: 'source-1:noop',
            status: MaintenanceActionStatus.Skipped,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      projectionPlan: {
        actions: [
          {
            actionType: 'noop',
            applyMode: MaintenanceApplyMode.Skip,
            confidence: 1,
            dedupeKey: 'noop',
            evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
            idempotencyKey: 'source-1:noop',
            rationale: 'No change needed.',
            risk: MaintenanceRisk.Low,
          },
        ],
        localDate: '2026-05-04',
        plannerVersion: 'test',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'No change needed.',
      },
      stepCount: 2,
    }));
    const runner = createMaintenanceAgentRunner({ maxSteps: 10, run, tools });

    const result = await runner.run({
      context: reviewContext,
      localDate: '2026-05-04',
      sourceId: 'source-1',
      userId: 'user-1',
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        context: reviewContext,
        localDate: '2026-05-04',
        maxSteps: 10,
        reviewScope: MaintenanceReviewScope.Nightly,
        sourceId: 'source-1',
        tools,
        userId: 'user-1',
      }),
    );
    expect(result.execution.sourceId).toBe('source-1');
    expect(result.projectionPlan.actions).toHaveLength(1);
  });

  /**
   * @example
   * expect(result.execution.status).toBe('failed');
   */
  it('returns a conservative failed envelope when the backend runner throws', async () => {
    const runner = createMaintenanceAgentRunner({
      run: vi.fn(async () => {
        throw new Error('model failed');
      }),
      tools: createNoopTools(),
    });

    const result = await runner.run({
      context: reviewContext,
      localDate: '2026-05-04',
      sourceId: 'source-1',
      userId: 'user-1',
    });

    expect(result.execution).toEqual({
      actions: [],
      sourceId: 'source-1',
      status: ReviewRunStatus.Failed,
    });
    expect(result.projectionPlan).toEqual(
      expect.objectContaining({
        actions: [],
        localDate: '2026-05-04',
        reviewScope: MaintenanceReviewScope.Nightly,
      }),
    );
    expect(result.stepCount).toBe(10);
  });
});
