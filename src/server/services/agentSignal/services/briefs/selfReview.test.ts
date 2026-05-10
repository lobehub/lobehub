// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';
import type { BriefItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  AgentSignalSelfReviewBriefService,
  type AgentSignalSelfReviewBriefServiceOptions,
} from '@/server/services/agentSignal/services/briefs/selfReview';
import { NIGHTLY_REVIEW_BRIEF_TRIGGER } from '@/server/services/agentSignal/services/maintenance/brief';
import { MaintenanceRisk } from '@/server/services/agentSignal/services/maintenance/types';

const mockCanAgentRunSelfIteration = vi.hoisted(() => vi.fn());
const mockIsAgentSignalEnabledForUser = vi.hoisted(() => vi.fn());
const mockPersistAgentSignalReceipts = vi.hoisted(() => vi.fn());
const mockReadWindow = vi.hoisted(() => vi.fn());
const mockSkillDocumentService = vi.hoisted(() => ({
  createSkill: vi.fn(),
  getSkill: vi.fn(),
  readSkillTargetSnapshot: vi.fn(),
  replaceSkillIndex: vi.fn(),
}));
const mockBriefModel = vi.hoisted(() => ({
  findById: vi.fn(),
  resolve: vi.fn(),
  updateMetadata: vi.fn(),
}));
const mockTaskModel = vi.hoisted(() => ({
  findById: vi.fn(),
  getUnlockedTasks: vi.fn(),
  updateStatus: vi.fn(),
}));
const mockTryDedupe = vi.hoisted(() => vi.fn());
const mockWriteWindow = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn().mockImplementation(() => mockBriefModel),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => mockTaskModel),
}));

vi.mock('@/database/models/agentSignal/reviewContext', () => ({
  AgentSignalReviewContextModel: vi.fn().mockImplementation(() => ({
    canAgentRunSelfIteration: mockCanAgentRunSelfIteration,
  })),
}));

vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: mockIsAgentSignalEnabledForUser,
}));

vi.mock('@/server/services/agentSignal/services/receiptService', () => ({
  createMaintenanceReviewReceipts: vi.fn(() => []),
  persistAgentSignalReceipts: mockPersistAgentSignalReceipts,
}));

vi.mock('@/server/services/agentSignal/store/adapters/redis/sourceEventStore', () => ({
  redisSourceEventStore: {
    readWindow: mockReadWindow,
    tryDedupe: mockTryDedupe,
    writeWindow: mockWriteWindow,
  },
}));

vi.mock('@/server/services/skillManagement/SkillManagementDocumentService', () => ({
  SkillManagementDocumentService: vi.fn().mockImplementation(() => mockSkillDocumentService),
}));

vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn().mockImplementation(() => ({
    cascadeOnCompletion: vi.fn().mockResolvedValue({ failed: [], paused: [], started: [] }),
  })),
}));

describe('AgentSignalSelfReviewBriefService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';
  const proposalMetadata = {
    actionType: 'refine_skill' as const,
    actions: [
      {
        actionType: 'refine_skill' as const,
        evidenceRefs: [],
        idempotencyKey: 'nightly:refine:adoc_1',
        rationale: 'Refine a managed skill.',
        risk: MaintenanceRisk.Medium,
      },
    ],
    createdAt: '2026-05-09T00:00:00.000Z',
    evidenceWindowEnd: '2026-05-09T00:00:00.000Z',
    evidenceWindowStart: '2026-05-08T00:00:00.000Z',
    expiresAt: '2026-05-12T00:00:00.000Z',
    proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
    status: 'pending' as const,
    updatedAt: '2026-05-09T00:00:00.000Z',
    version: 1 as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (BriefModel as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockBriefModel);
    mockTaskModel.getUnlockedTasks.mockResolvedValue([]);
    mockBriefModel.findById.mockResolvedValue(null);
    mockCanAgentRunSelfIteration.mockResolvedValue(true);
    mockIsAgentSignalEnabledForUser.mockResolvedValue(true);
    mockPersistAgentSignalReceipts.mockResolvedValue(undefined);
    mockReadWindow.mockResolvedValue(undefined);
    mockSkillDocumentService.createSkill.mockResolvedValue({
      bundle: { agentDocumentId: 'adoc_created' },
      name: 'code-review',
    });
    mockSkillDocumentService.getSkill.mockResolvedValue(undefined);
    mockSkillDocumentService.readSkillTargetSnapshot.mockResolvedValue(undefined);
    mockSkillDocumentService.replaceSkillIndex.mockResolvedValue(undefined);
    mockTryDedupe.mockResolvedValue(true);
    mockWriteWindow.mockResolvedValue(undefined);
  });

  const resolveWithMaintenanceProposal = async (
    id: string,
    options?: { action?: string; comment?: string },
    maintenanceProposalResolver?: AgentSignalSelfReviewBriefServiceOptions['maintenanceProposalResolver'],
  ) => {
    const brief = (await mockBriefModel.findById(id)) as BriefItem | null;
    if (!brief) return null;

    return new AgentSignalSelfReviewBriefService(db, userId, {
      maintenanceProposalResolver,
    }).resolve(brief, options);
  };

  /**
   * @example
   * expect(mockBriefModel.resolve).toHaveBeenCalledWith('proposal-1', { action: 'approve' });
   */
  it('applies a pending maintenance proposal before resolving an approved brief', async () => {
    const maintenanceProposalResolver = vi.fn().mockResolvedValue({
      brief: { id: 'proposal-1' },
      shouldResolve: true,
    });
    mockBriefModel.findById.mockResolvedValue({
      id: 'proposal-1',
      metadata: { proposal: proposalMetadata },
      trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
    });
    mockBriefModel.resolve.mockResolvedValue({ id: 'proposal-1', resolvedAction: 'approve' });

    const result = await resolveWithMaintenanceProposal(
      'proposal-1',
      { action: 'approve' },
      maintenanceProposalResolver,
    );

    expect(maintenanceProposalResolver).toHaveBeenCalledWith({
      action: 'approve',
      brief: expect.objectContaining({ id: 'proposal-1' }),
      proposal: proposalMetadata,
    });
    expect(mockBriefModel.resolve).toHaveBeenCalledWith('proposal-1', { action: 'approve' });
    expect(result).toEqual({ id: 'proposal-1', resolvedAction: 'approve' });
  });

  /**
   * @example
   * expect(mockBriefModel.resolve).not.toHaveBeenCalled();
   */
  it('keeps stale maintenance proposal briefs unresolved after approve preflight fails', async () => {
    const unresolvedBrief = {
      id: 'proposal-2',
      metadata: { proposal: { ...proposalMetadata, status: 'stale' } },
      trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
    };
    const maintenanceProposalResolver = vi.fn().mockResolvedValue({
      brief: unresolvedBrief,
      shouldResolve: false,
    });
    mockBriefModel.findById.mockResolvedValue({
      id: 'proposal-2',
      metadata: { proposal: proposalMetadata },
      trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
    });

    const result = await resolveWithMaintenanceProposal(
      'proposal-2',
      { action: 'approve' },
      maintenanceProposalResolver,
    );

    expect(result).toBe(unresolvedBrief);
    expect(mockBriefModel.resolve).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(maintenanceProposalResolver).toHaveBeenCalledWith(expect.objectContaining({ action: 'dismiss' }));
   */
  it('dismisses pending maintenance proposals through the proposal resolver', async () => {
    const maintenanceProposalResolver = vi.fn().mockResolvedValue({
      brief: { id: 'proposal-3' },
      shouldResolve: true,
    });
    mockBriefModel.findById.mockResolvedValue({
      id: 'proposal-3',
      metadata: { proposal: proposalMetadata },
      trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
    });
    mockBriefModel.resolve.mockResolvedValue({ id: 'proposal-3', resolvedAction: 'dismiss' });

    await resolveWithMaintenanceProposal(
      'proposal-3',
      { action: 'dismiss' },
      maintenanceProposalResolver,
    );

    expect(maintenanceProposalResolver).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dismiss' }),
    );
    expect(mockBriefModel.resolve).toHaveBeenCalledWith('proposal-3', { action: 'dismiss' });
  });

  /**
   * @example
   * expect(mockSkillDocumentService.createSkill).toHaveBeenCalledWith(expect.objectContaining({ name: 'code-review' }));
   */
  it('applies fresh create_skill maintenance proposals through the default approve resolver', async () => {
    const createProposalMetadata = {
      ...proposalMetadata,
      actionType: 'create_skill' as const,
      actions: [
        {
          actionType: 'create_skill' as const,
          baseSnapshot: {
            absent: true,
            skillName: 'code-review',
            targetType: 'skill' as const,
          },
          evidenceRefs: [],
          idempotencyKey: 'nightly:create:code-review',
          operation: {
            domain: 'skill' as const,
            input: {
              bodyMarkdown: 'Review preferences',
              description: 'Reusable review preferences.',
              name: 'code-review',
              title: 'Code Review',
              userId,
            },
            operation: 'create' as const,
          },
          rationale: 'Create a managed skill.',
          risk: MaintenanceRisk.Medium,
          target: { skillName: 'code-review' },
        },
      ],
      proposalKey: 'agt_1:create_skill:skill:code-review',
    };
    const pendingBrief = {
      agentId: 'agt_1',
      id: 'proposal-create',
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            localDate: '2026-05-09',
            maintenanceProposal: createProposalMetadata,
            sourceId: 'source-create',
            timezone: 'Asia/Shanghai',
          },
        },
      },
      trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
    };

    mockBriefModel.findById.mockResolvedValueOnce(pendingBrief).mockResolvedValueOnce({
      ...pendingBrief,
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            maintenanceProposal: { status: 'applied' },
          },
        },
      },
    });
    mockBriefModel.updateMetadata.mockResolvedValue(pendingBrief);
    mockBriefModel.resolve.mockResolvedValue({
      id: 'proposal-create',
      resolvedAction: 'approve',
    });

    const result = await resolveWithMaintenanceProposal('proposal-create', { action: 'approve' });

    expect(mockSkillDocumentService.getSkill).toHaveBeenCalledWith({
      agentId: 'agt_1',
      name: 'code-review',
    });
    expect(mockSkillDocumentService.createSkill).toHaveBeenCalledWith({
      agentId: 'agt_1',
      bodyMarkdown: 'Review preferences',
      description: 'Reusable review preferences.',
      name: 'code-review',
      title: 'Code Review',
    });
    expect(mockReadWindow).toHaveBeenCalledWith('maintenance-operation:nightly:create:code-review');
    expect(mockTryDedupe).toHaveBeenCalledWith(
      'maintenance-operation-reserve:nightly:create:code-review',
      expect.any(Number),
    );
    expect(mockPersistAgentSignalReceipts).toHaveBeenCalledWith([
      expect.objectContaining({
        agentId: 'agt_1',
        id: 'nightly:create:code-review',
        kind: 'skill',
        sourceId: 'source-create',
        sourceType: 'agent.maintenance_proposal.approved',
        status: 'applied',
        topicId: 'source-create',
        userId,
      }),
    ]);
    expect(mockWriteWindow).toHaveBeenCalledWith(
      'maintenance-operation:nightly:create:code-review',
      {
        result: JSON.stringify({
          receiptId: 'nightly:create:code-review',
          resourceId: 'adoc_created',
          status: 'applied',
          summary: 'Created managed skill code-review.',
        }),
      },
      expect.any(Number),
    );
    expect(mockBriefModel.resolve).toHaveBeenCalledWith('proposal-create', {
      action: 'approve',
    });
    expect(result).toEqual({ id: 'proposal-create', resolvedAction: 'approve' });
  });

  /**
   * @example
   * expect(mockSkillDocumentService.createSkill).not.toHaveBeenCalled();
   */
  it('dedupes repeated create_skill approvals through the maintenance operation reservation', async () => {
    const createProposalMetadata = {
      ...proposalMetadata,
      actionType: 'create_skill' as const,
      actions: [
        {
          actionType: 'create_skill' as const,
          baseSnapshot: {
            absent: true,
            skillName: 'code-review',
            targetType: 'skill' as const,
          },
          evidenceRefs: [],
          idempotencyKey: 'nightly:create:code-review',
          operation: {
            domain: 'skill' as const,
            input: {
              bodyMarkdown: 'Review preferences',
              description: 'Reusable review preferences.',
              name: 'code-review',
              title: 'Code Review',
              userId,
            },
            operation: 'create' as const,
          },
          rationale: 'Create a managed skill.',
          risk: MaintenanceRisk.Medium,
          target: { skillName: 'code-review' },
        },
      ],
      proposalKey: 'agt_1:create_skill:skill:code-review',
    };
    const pendingBrief = {
      agentId: 'agt_1',
      id: 'proposal-create',
      metadata: {
        proposal: createProposalMetadata,
        sourceId: 'source-create',
      },
      trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
    };
    mockReadWindow.mockResolvedValue({
      result: JSON.stringify({
        receiptId: 'nightly:create:code-review',
        resourceId: 'adoc_created',
        status: 'applied',
        summary: 'Already created.',
      }),
    });
    mockBriefModel.findById
      .mockResolvedValueOnce(pendingBrief)
      .mockResolvedValueOnce({ ...pendingBrief, metadata: { proposal: { status: 'applied' } } });
    mockBriefModel.updateMetadata.mockResolvedValue(pendingBrief);
    mockBriefModel.resolve.mockResolvedValue({
      id: 'proposal-create',
      resolvedAction: 'approve',
    });

    const result = await resolveWithMaintenanceProposal('proposal-create', { action: 'approve' });

    expect(mockSkillDocumentService.createSkill).not.toHaveBeenCalled();
    expect(mockTryDedupe).not.toHaveBeenCalled();
    expect(mockPersistAgentSignalReceipts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'nightly:create:code-review',
        kind: 'skill',
        sourceType: 'agent.maintenance_proposal.approved',
        status: 'skipped',
      }),
    ]);
    expect(mockWriteWindow).not.toHaveBeenCalled();
    expect(mockBriefModel.resolve).toHaveBeenCalledWith('proposal-create', {
      action: 'approve',
    });
    expect(result).toEqual({ id: 'proposal-create', resolvedAction: 'approve' });
  });
});
