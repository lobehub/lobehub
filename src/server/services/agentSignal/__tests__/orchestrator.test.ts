// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';

import type { AgentSignalEmitOptions } from '../emitter';
import { withServerAgentSignalPolicyDefaults } from '../orchestrator';
import { createBriefMaintenanceService } from '../services/maintenance/brief';
import { MaintenanceActionStatus, ReviewRunStatus } from '../services/maintenance/types';

const createNightlyReviewOptions = (): NonNullable<
  NonNullable<AgentSignalEmitOptions['policyOptions']>['nightlyReview']
> => ({
  acquireReviewGuard: vi.fn(async () => true),
  canRunReview: vi.fn(async () => true),
  collectContext: vi.fn(async () => ({
    agentId: 'agent-1',
    managedSkills: [],
    relevantMemories: [],
    reviewWindowEnd: '2026-05-04T14:30:00.000Z',
    reviewWindowStart: '2026-05-03T16:00:00.000Z',
    topics: [],
    userId: 'user-1',
  })),
  executePlan: vi.fn(async () => ({
    actions: [],
    status: ReviewRunStatus.Completed,
  })),
  planReviewOutput: vi.fn((request) => ({
    actions: [],
    localDate: request.localDate,
    plannerVersion: 'test',
    reviewScope: request.reviewScope,
    summary: request.draft.summary,
  })),
  runMaintenanceReviewAgent: vi.fn(async () => ({
    actions: [],
    findings: [],
    summary: 'Quiet night.',
  })),
});

describe('Agent Signal orchestrator policy defaults', () => {
  /**
   * @example
   * expect(result).toBeUndefined().
   */
  it('does not install nightly brief writing for analyze-intent-only policy options', () => {
    expect(
      withServerAgentSignalPolicyDefaults(
        {
          skillManagement: {
            selfIterationEnabled: true,
          },
        },
        { db: {} as never, userId: 'user-1' },
      )?.nightlyReview,
    ).toBeUndefined();
  });

  /**
   * @example
   * expect(options.nightlyReview?.writeDailyBrief).toBeTypeOf('function').
   */
  it('adds a server BriefModel writer when nightly review deps omit one', async () => {
    const create = vi.spyOn(BriefModel.prototype, 'create').mockResolvedValue({
      agentId: 'agent-1',
      createdAt: new Date('2026-05-04T14:30:00.000Z'),
      id: 'brief-1',
      metadata: {},
      priority: 'info',
      summary: '1 maintenance update applied.',
      title: 'Agent self-review updated resources',
      trigger: 'agent-signal:nightly-review',
      type: 'insight',
      userId: 'user-1',
    } as Awaited<ReturnType<BriefModel['create']>>);
    const policyOptions = withServerAgentSignalPolicyDefaults(
      {
        nightlyReview: createNightlyReviewOptions(),
      },
      { db: {} as never, userId: 'user-1' },
    );
    const brief = createBriefMaintenanceService().projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:write_memory:memory:concise',
            receiptId: 'receipt-1',
            status: MaintenanceActionStatus.Applied,
            summary: 'Saved concise PR summary preference.',
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!brief) throw new Error('Expected projected brief');

    await expect(policyOptions?.nightlyReview?.writeDailyBrief?.(brief)).resolves.toMatchObject({
      id: 'brief-1',
    });
    expect(create).toHaveBeenCalledWith(brief);
  });

  /**
   * @example
   * expect(existingWriter).toHaveBeenCalled().
   */
  it('preserves an explicitly injected nightly brief writer', async () => {
    const writeDailyBrief = vi.fn(async () => ({ id: 'custom-brief' }));
    const policyOptions = withServerAgentSignalPolicyDefaults(
      {
        nightlyReview: {
          ...createNightlyReviewOptions(),
          writeDailyBrief,
        },
      },
      { db: {} as never, userId: 'user-1' },
    );

    await expect(policyOptions?.nightlyReview?.writeDailyBrief?.({} as never)).resolves.toEqual({
      id: 'custom-brief',
    });
    expect(writeDailyBrief).toHaveBeenCalled();
  });
});
