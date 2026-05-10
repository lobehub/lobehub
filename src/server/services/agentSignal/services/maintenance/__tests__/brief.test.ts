// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';

import { createBriefMaintenanceService, createServerMaintenanceBriefWriter } from '../brief';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
  ReviewRunStatus,
} from '../types';

afterEach(() => {
  vi.restoreAllMocks();
});

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
   * Planned noop actions that execute as proposed remain silent.
   */
  it('does not create proposal briefs for proposed noop actions with receipts', () => {
    const service = createBriefMaintenanceService();

    expect(
      service.projectNightlyReviewBrief({
        agentId: 'agent-1',
        localDate: '2026-05-09',
        plan: {
          actions: [
            {
              actionType: 'noop',
              applyMode: MaintenanceApplyMode.ProposalOnly,
              confidence: 0.9,
              dedupeKey: 'noop:quiet',
              evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
              idempotencyKey: 'source:noop:quiet',
              rationale: 'No maintenance change is needed.',
              risk: MaintenanceRisk.Low,
            },
          ],
          plannerVersion: 'test-planner',
          reviewScope: MaintenanceReviewScope.Nightly,
          summary: 'Review found no actionable maintenance.',
        },
        result: {
          actions: [
            {
              idempotencyKey: 'source:noop:quiet',
              receiptId: 'source:noop:quiet:action',
              status: MaintenanceActionStatus.Proposed,
              summary: 'No maintenance change is needed.',
            },
          ],
          status: ReviewRunStatus.Completed,
        },
        reviewWindowEnd: '2026-05-09T20:00:00.000Z',
        reviewWindowStart: '2026-05-09T18:00:00.000Z',
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
   * Proposal briefs retain the frozen action payload needed for later approval.
   */
  it('stores frozen proposal actions on proposal briefs', () => {
    const service = createBriefMaintenanceService();
    const projected = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'adoc-1', type: 'agent_document' }],
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            operation: {
              domain: 'skill',
              input: {
                patch: 'Use the existing skill index.',
                skillDocumentId: 'adoc-1',
                userId: 'user-1',
              },
              operation: 'refine',
            },
            rationale: 'Refine the managed skill instead of creating duplicate skill drafts.',
            risk: MaintenanceRisk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Review found a skill refinement proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            receiptId: 'source:refine_skill:skill:adoc-1:action',
            status: MaintenanceActionStatus.Proposed,
            summary: 'Refine the managed skill instead of creating duplicate skill drafts.',
          },
        ],
        sourceId: 'source',
        status: ReviewRunStatus.Completed,
        summaryReceiptId: 'source:review-summary',
      },
      reviewWindowEnd: '2026-05-09T20:00:00.000Z',
      reviewWindowStart: '2026-05-09T18:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(projected?.actions).toEqual([
      { key: 'approve', label: 'Apply', type: 'resolve' },
      { key: 'dismiss', label: 'Dismiss', type: 'resolve' },
      { key: 'feedback', label: 'Request changes', type: 'comment' },
    ]);
    expect(projected?.metadata.proposal).toMatchObject({
      proposalKey: 'agent-1:refine_skill:agent_document:adoc-1',
      status: 'pending',
      version: 1,
    });
    expect(projected?.metadata.proposal?.actions[0]).toMatchObject({
      actionType: 'refine_skill',
      idempotencyKey: 'source:refine_skill:skill:adoc-1',
      operation: {
        domain: 'skill',
        operation: 'refine',
      },
    });
  });

  /**
   * @example
   * Mixed noop and actionable proposed results only freeze the actionable proposal metadata.
   */
  it('stores proposal metadata only for real proposed actions when noop results are mixed in', () => {
    const service = createBriefMaintenanceService();
    const projected = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'noop',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.9,
            dedupeKey: 'noop:quiet',
            evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
            idempotencyKey: 'source:noop:quiet',
            rationale: 'No maintenance change is needed.',
            risk: MaintenanceRisk.Low,
          },
          {
            actionType: 'refine_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'adoc-1', type: 'agent_document' }],
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            operation: {
              domain: 'skill',
              input: {
                patch: 'Use the existing skill index.',
                skillDocumentId: 'adoc-1',
                userId: 'user-1',
              },
              operation: 'refine',
            },
            rationale: 'Refine the managed skill instead of creating duplicate skill drafts.',
            risk: MaintenanceRisk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Review found one actionable proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:noop:quiet',
            receiptId: 'source:noop:quiet:action',
            status: MaintenanceActionStatus.Proposed,
            summary: 'No maintenance change is needed.',
          },
          {
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            receiptId: 'source:refine_skill:skill:adoc-1:action',
            status: MaintenanceActionStatus.Proposed,
            summary: 'Refine the managed skill instead of creating duplicate skill drafts.',
          },
        ],
        sourceId: 'source',
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-09T20:00:00.000Z',
      reviewWindowStart: '2026-05-09T18:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(projected?.metadata.actionCounts.proposed).toBe(1);
    expect(projected?.summary).toContain('1 maintenance proposal need review.');
    expect(projected?.summary).not.toContain('No maintenance change is needed.');
    expect(projected?.metadata.proposal?.actions).toHaveLength(1);
    expect(projected?.metadata.proposal?.actions[0]).toMatchObject({
      actionType: 'refine_skill',
      idempotencyKey: 'source:refine_skill:skill:adoc-1',
    });
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

  /**
   * @example
   * A compatible pending proposal refreshes the old brief instead of creating a duplicate.
   */
  it('refreshes an existing compatible pending proposal brief', async () => {
    const service = createBriefMaintenanceService();
    const incoming = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'msg-new', type: 'message' }],
            idempotencyKey: 'source:new',
            operation: {
              domain: 'skill',
              input: { patch: 'new body', skillDocumentId: 'adoc-1', userId: 'user-1' },
              operation: 'refine',
            },
            rationale: 'Refresh the same proposal.',
            risk: MaintenanceRisk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Refresh proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:new',
            receiptId: 'receipt-new',
            status: MaintenanceActionStatus.Proposed,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-10T00:00:00.000Z',
      reviewWindowStart: '2026-05-09T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!incoming?.metadata.proposal) throw new Error('Expected projected proposal brief');

    const existingProposal = {
      ...incoming.metadata.proposal,
      actions: [
        {
          ...incoming.metadata.proposal.actions[0],
          idempotencyKey: 'source:old',
          rationale: 'Old rationale.',
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
      expiresAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    };
    const existingBrief = {
      agentId: 'agent-1',
      id: 'brief-old',
      metadata: { proposal: existingProposal },
      trigger: 'agent-signal:nightly-review',
    } as Awaited<ReturnType<BriefModel['create']>>;
    const updatedBrief = {
      ...existingBrief,
      metadata: { proposal: { ...existingProposal, actions: incoming.metadata.proposal.actions } },
    } as Awaited<ReturnType<BriefModel['create']>>;
    const create = vi.spyOn(BriefModel.prototype, 'create');
    const listUnresolvedByAgentAndTrigger = vi
      .spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger')
      .mockResolvedValue([existingBrief]);
    const updateMetadata = vi
      .spyOn(BriefModel.prototype, 'updateMetadata')
      .mockResolvedValue(updatedBrief);
    const writer = createServerMaintenanceBriefWriter({} as never, 'user-1');

    await expect(writer.writeDailyBrief(incoming)).resolves.toBe(updatedBrief);

    expect(listUnresolvedByAgentAndTrigger).toHaveBeenCalledWith({
      agentId: 'agent-1',
      limit: 20,
      trigger: 'agent-signal:nightly-review',
    });
    expect(create).not.toHaveBeenCalled();
    expect(updateMetadata).toHaveBeenCalledWith(
      'brief-old',
      expect.objectContaining({
        proposal: expect.objectContaining({
          actions: incoming.metadata.proposal.actions,
          status: 'pending',
        }),
      }),
    );
  });

  /**
   * @example
   * An incompatible same-key proposal supersedes the old brief and creates a new one.
   */
  it('supersedes an incompatible pending proposal before creating a replacement brief', async () => {
    const service = createBriefMaintenanceService();
    const incoming = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'msg-new', type: 'message' }],
            idempotencyKey: 'source:new',
            operation: {
              domain: 'skill',
              input: { patch: 'new body', skillDocumentId: 'adoc-1', userId: 'user-1' },
              operation: 'refine',
            },
            rationale: 'Replace the old proposal.',
            risk: MaintenanceRisk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Replacement proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:new',
            receiptId: 'receipt-new',
            status: MaintenanceActionStatus.Proposed,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-10T00:00:00.000Z',
      reviewWindowStart: '2026-05-09T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!incoming?.metadata.proposal) throw new Error('Expected projected proposal brief');

    const existingProposal = incoming.metadata.proposal;
    incoming.metadata.proposal = {
      ...incoming.metadata.proposal,
      actions: [
        {
          ...incoming.metadata.proposal.actions[0],
          operation: {
            domain: 'skill',
            input: { bodyMarkdown: 'new skill', name: 'new-skill', userId: 'user-1' },
            operation: 'create',
          },
        },
      ],
    };
    const existingBrief = {
      agentId: 'agent-1',
      id: 'brief-old',
      metadata: { proposal: existingProposal },
      trigger: 'agent-signal:nightly-review',
    } as Awaited<ReturnType<BriefModel['create']>>;
    const createdBrief = { id: 'brief-new' } as Awaited<ReturnType<BriefModel['create']>>;
    const create = vi.spyOn(BriefModel.prototype, 'create').mockResolvedValue(createdBrief);
    vi.spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger').mockResolvedValue([
      existingBrief,
    ]);
    const updateMetadata = vi
      .spyOn(BriefModel.prototype, 'updateMetadata')
      .mockResolvedValue(existingBrief);
    const writer = createServerMaintenanceBriefWriter({} as never, 'user-1');

    await expect(writer.writeDailyBrief(incoming)).resolves.toBe(createdBrief);

    expect(updateMetadata).toHaveBeenCalledWith(
      'brief-old',
      expect.objectContaining({
        proposal: expect.objectContaining({
          status: 'superseded',
          supersededBy: incoming.metadata.proposal.proposalKey,
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(incoming);
  });

  /**
   * @example
   * An expired pending proposal is marked expired and a fresh proposal brief is created.
   */
  it('marks expired pending proposals before creating a fresh brief', async () => {
    const service = createBriefMaintenanceService();
    const incoming = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [],
            idempotencyKey: 'source:new',
            operation: {
              domain: 'skill',
              input: { patch: 'new body', skillDocumentId: 'adoc-1', userId: 'user-1' },
              operation: 'refine',
            },
            rationale: 'Create a fresh proposal.',
            risk: MaintenanceRisk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Fresh proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:new',
            receiptId: 'receipt-new',
            status: MaintenanceActionStatus.Proposed,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-13T00:00:00.000Z',
      reviewWindowStart: '2026-05-12T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!incoming?.metadata.proposal) throw new Error('Expected projected proposal brief');

    const existingProposal = {
      ...incoming.metadata.proposal,
      expiresAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    };
    const existingBrief = {
      agentId: 'agent-1',
      id: 'brief-old',
      metadata: { proposal: existingProposal },
      trigger: 'agent-signal:nightly-review',
    } as Awaited<ReturnType<BriefModel['create']>>;
    const createdBrief = { id: 'brief-new' } as Awaited<ReturnType<BriefModel['create']>>;
    const create = vi.spyOn(BriefModel.prototype, 'create').mockResolvedValue(createdBrief);
    vi.spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger').mockResolvedValue([
      existingBrief,
    ]);
    const updateMetadata = vi
      .spyOn(BriefModel.prototype, 'updateMetadata')
      .mockResolvedValue(existingBrief);
    const writer = createServerMaintenanceBriefWriter({} as never, 'user-1');

    await expect(writer.writeDailyBrief(incoming)).resolves.toBe(createdBrief);

    expect(updateMetadata).toHaveBeenCalledWith(
      'brief-old',
      expect.objectContaining({
        proposal: expect.objectContaining({ status: 'expired' }),
      }),
    );
    expect(create).toHaveBeenCalledWith(incoming);
  });
});
