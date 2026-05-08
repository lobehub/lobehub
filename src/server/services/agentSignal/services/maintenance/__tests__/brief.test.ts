// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';

import { createBriefMaintenanceService, createServerMaintenanceBriefWriter } from '../brief';
import { MaintenanceActionStatus, ReviewRunStatus } from '../types';

describe('briefMaintenanceService', () => {
  /**
   * @example
   * Applied nightly actions produce an insight brief with stable trigger metadata.
   */
  it('projects applied nightly results to insight briefs', () => {
    const service = createBriefMaintenanceService();

    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:write_memory:memory:concise',
            receiptId: 'receipt-1',
            resourceId: 'mem-1',
            status: MaintenanceActionStatus.Applied,
            summary: 'Saved concise PR summary preference.',
          },
        ],
        sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(brief).toMatchObject({
      agentId: 'agent-1',
      trigger: 'agent-signal:nightly-review',
      type: 'insight',
    });
    expect(brief?.metadata).toMatchObject({
      actionCounts: { applied: 1, failed: 0, proposed: 0, skipped: 0 },
      localDate: '2026-05-04',
      outcome: 'applied',
      receiptIds: ['receipt-1'],
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      timezone: 'Asia/Shanghai',
    });
  });

  /**
   * @example
   * Pure noop results do not create Daily Briefs.
   */
  it('does not create briefs for pure noop outcomes', () => {
    const service = createBriefMaintenanceService();

    expect(
      service.projectNightlyReviewBrief({
        agentId: 'agent-1',
        localDate: '2026-05-04',
        result: { actions: [], status: ReviewRunStatus.Completed },
        reviewWindowEnd: '2026-05-04T14:30:00.000Z',
        reviewWindowStart: '2026-05-03T16:00:00.000Z',
        timezone: 'Asia/Shanghai',
        userId: 'user-1',
      }),
    ).toBeUndefined();
  });

  /**
   * @example
   * Proposal actions produce decision briefs.
   */
  it('projects proposal results to decision briefs', () => {
    const service = createBriefMaintenanceService();

    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:proposal_only:skill:merge',
            receiptId: 'receipt-2',
            status: MaintenanceActionStatus.Proposed,
            summary: 'Review skill consolidation proposal.',
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(brief).toMatchObject({
      trigger: 'agent-signal:nightly-review',
      type: 'decision',
    });
    expect(brief?.priority).toBe('normal');
    expect(brief?.summary).toContain('1 maintenance proposal need review.');
    expect(brief?.summary).toContain('**Proposal**');
    expect(brief?.summary).toContain('- Review skill consolidation proposal.');
  });

  /**
   * @example
   * Failed nightly runs produce an error brief when there is a user-actionable failure.
   */
  it('projects failed nightly outcomes to error briefs', () => {
    const service = createBriefMaintenanceService();

    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:write_memory:memory:concise',
            status: MaintenanceActionStatus.Failed,
            summary: 'Memory service unavailable.',
          },
        ],
        status: ReviewRunStatus.Failed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(brief).toMatchObject({
      priority: 'normal',
      type: 'error',
    });
    expect(brief?.metadata).toMatchObject({
      outcome: 'error',
    });
  });

  /**
   * @example
   * Pending maintenance proposals stay visible when self-iteration is disabled.
   */
  it('keeps pending maintenance proposals visible after self-iteration is disabled', () => {
    const service = createBriefMaintenanceService();

    expect(
      service.isMaintenanceProposalVisible({
        selfIterationEnabled: false,
        status: 'pending',
        trigger: 'agent-signal:nightly-review',
      }),
    ).toBe(true);
  });

  /**
   * @example
   * Applying a maintenance proposal re-checks server, user, and agent gates.
   */
  it('blocks proposal apply when any current self-iteration gate is disabled', async () => {
    const service = createBriefMaintenanceService();

    await expect(
      service.canApplyMaintenanceProposal({
        checkAgentGate: vi.fn(async () => true),
        checkServerGate: vi.fn(async () => true),
        checkUserGate: vi.fn(async () => false),
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'user_gate_disabled',
    });
  });

  /**
   * @example
   * Applying a maintenance proposal is allowed only when all gates pass.
   */
  it('allows proposal apply when all current gates pass', async () => {
    const service = createBriefMaintenanceService();

    await expect(
      service.canApplyMaintenanceProposal({
        checkAgentGate: vi.fn(async () => true),
        checkServerGate: vi.fn(async () => true),
        checkUserGate: vi.fn(async () => true),
      }),
    ).resolves.toEqual({ allowed: true });
  });

  /**
   * @example
   * The server writer persists through BriefModel.create for the source-event user.
   */
  it('creates server brief rows through BriefModel', async () => {
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
    const writer = createServerMaintenanceBriefWriter({} as never, 'user-1');
    const service = createBriefMaintenanceService();
    const brief = service.projectNightlyReviewBrief({
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

    await expect(writer.writeDailyBrief(brief)).resolves.toMatchObject({ id: 'brief-1' });
    expect(create).toHaveBeenCalledWith(brief);
  });
});
