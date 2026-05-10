import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MaintenanceProposalMetadata } from '../proposal';
import { createMaintenanceProposalApplyService } from '../proposalApply';
import type { RefineMaintenanceSkillInput } from '../skill';
import { MaintenanceRisk } from '../types';

const { spanEnd, spanSetAttribute, spanSetStatus, startActiveSpan } = vi.hoisted(() => {
  interface MockSpan {
    end: ReturnType<typeof vi.fn>;
    recordException: ReturnType<typeof vi.fn>;
    setAttribute: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  }

  const spanSetAttribute = vi.fn();
  const spanSetStatus = vi.fn();
  const spanEnd = vi.fn();
  const startActiveSpan = vi.fn(
    async (_name: string, _options: unknown, callback: (span: MockSpan) => unknown) =>
      callback({
        end: spanEnd,
        recordException: vi.fn(),
        setAttribute: spanSetAttribute,
        setStatus: spanSetStatus,
      }),
  );

  return { spanEnd, spanSetAttribute, spanSetStatus, startActiveSpan };
});

vi.mock('@lobechat/observability-otel/modules/agent-signal', () => ({
  tracer: { startActiveSpan },
}));

const createProposal = (
  overrides: Partial<MaintenanceProposalMetadata> = {},
): MaintenanceProposalMetadata => ({
  actionType: 'refine_skill',
  actions: [
    {
      actionType: 'refine_skill',
      baseSnapshot: {
        agentDocumentId: 'adoc_1',
        contentHash: 'sha256:base',
        documentId: 'doc_1',
        managed: true,
        targetType: 'skill',
        writable: true,
      },
      evidenceRefs: [{ id: 'msg_1', type: 'message' }],
      idempotencyKey: 'nightly:refine_skill:adoc_1',
      operation: {
        domain: 'skill' as const,
        input: {
          bodyMarkdown: 'new body',
          description: 'Updated review workflow.',
          skillDocumentId: 'adoc_1',
          userId: 'user_1',
        } as unknown as RefineMaintenanceSkillInput,
        operation: 'refine' as const,
      },
      rationale: 'Keep the skill up to date.',
      risk: MaintenanceRisk.Medium,
      target: { skillDocumentId: 'adoc_1' },
    },
  ],
  createdAt: '2026-05-09T00:00:00.000Z',
  evidenceWindowEnd: '2026-05-09T00:00:00.000Z',
  evidenceWindowStart: '2026-05-08T00:00:00.000Z',
  expiresAt: '2026-05-12T00:00:00.000Z',
  proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
  status: 'pending',
  updatedAt: '2026-05-09T00:00:00.000Z',
  version: 1,
  ...overrides,
});

describe('maintenance proposal apply service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @example
   * expect(result.proposal.status).toBe('applied');
   */
  it('applies fresh refine_skill proposal actions through replaceSkillContentCAS', async () => {
    const replaceSkillContentCAS = vi.fn().mockResolvedValue({
      resourceId: 'adoc_1',
      status: 'applied',
      summary: 'Refined managed skill.',
    });
    const createSkillIfAbsent = vi.fn();
    const updateProposal = vi.fn();
    const service = createMaintenanceProposalApplyService({
      checkAction: vi.fn().mockResolvedValue({ allowed: true }),
      checkGates: vi.fn().mockResolvedValue({ allowed: true }),
      now: () => '2026-05-09T01:00:00.000Z',
      tools: {
        createSkillIfAbsent,
        replaceSkillContentCAS,
      },
      updateProposal,
    });

    const result = await service.apply({
      agentId: 'agt_1',
      proposal: createProposal(),
      sourceId: 'nightly-review:user_1:agt_1:2026-05-09',
      sourceType: 'agent.nightly_review.requested',
      userId: 'user_1',
    });

    expect(replaceSkillContentCAS).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSnapshot: expect.objectContaining({
          agentDocumentId: 'adoc_1',
          contentHash: 'sha256:base',
          documentId: 'doc_1',
        }),
        bodyMarkdown: 'new body',
        description: 'Updated review workflow.',
        idempotencyKey: 'nightly:refine_skill:adoc_1',
        proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
        skillDocumentId: 'adoc_1',
        userId: 'user_1',
      }),
    );
    expect(createSkillIfAbsent).not.toHaveBeenCalled();
    expect(result.proposal.status).toBe('applied');
    expect(result.proposal.applyAttempts?.[0].actionResults).toEqual([
      {
        idempotencyKey: 'nightly:refine_skill:adoc_1',
        resourceId: 'adoc_1',
        status: 'applied',
        summary: 'Refined managed skill.',
      },
    ]);
    expect(updateProposal).toHaveBeenCalledWith(result.proposal);
    expect(startActiveSpan).toHaveBeenCalledWith(
      'agent_signal.maintenance_proposal.apply',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'agent.signal.agent_id': 'agt_1',
          'agent.signal.proposal.action_count': 1,
          'agent.signal.proposal.key': 'agt_1:refine_skill:agent_document:adoc_1',
          'agent.signal.source_id': 'nightly-review:user_1:agt_1:2026-05-09',
          'agent.signal.user_id': 'user_1',
        }),
      }),
      expect.any(Function),
    );
    expect(spanSetAttribute).toHaveBeenCalledWith('agent.signal.proposal.apply_status', 'applied');
    expect(spanSetAttribute).toHaveBeenCalledWith(
      'agent.signal.proposal.executable_action_count',
      1,
    );
    expect(spanSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(spanEnd).toHaveBeenCalled();
  });

  /**
   * @example
   * expect(tools.createSkillIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ name: 'code-review' }));
   */
  it('applies fresh create_skill proposal actions through createSkillIfAbsent', async () => {
    const createSkillIfAbsent = vi.fn().mockResolvedValue({
      resourceId: 'adoc_created',
      status: 'deduped',
      summary: 'Skill already created.',
    });
    const replaceSkillContentCAS = vi.fn();
    const service = createMaintenanceProposalApplyService({
      checkAction: vi.fn().mockResolvedValue({ allowed: true }),
      checkGates: vi.fn().mockResolvedValue({ allowed: true }),
      now: () => '2026-05-09T01:00:00.000Z',
      tools: {
        createSkillIfAbsent,
        replaceSkillContentCAS,
      },
      updateProposal: vi.fn(),
    });

    const result = await service.apply({
      agentId: 'agt_1',
      proposal: createProposal({
        actionType: 'create_skill',
        actions: [
          {
            actionType: 'create_skill',
            baseSnapshot: {
              absent: true,
              skillName: 'code-review',
              targetType: 'skill',
            },
            evidenceRefs: [],
            idempotencyKey: 'nightly:create_skill:code-review',
            operation: {
              domain: 'skill',
              input: {
                bodyMarkdown: 'Review preferences',
                description: 'Reusable review preferences.',
                name: 'code-review',
                title: 'Code Review',
                userId: 'user_1',
              },
              operation: 'create',
            },
            rationale: 'Create a managed skill.',
            risk: MaintenanceRisk.Medium,
            target: { skillName: 'code-review' },
          },
        ],
        proposalKey: 'agt_1:create_skill:skill:code-review',
      }),
      sourceId: 'nightly-review:user_1:agt_1:2026-05-09',
      sourceType: 'agent.nightly_review.requested',
      userId: 'user_1',
    });

    expect(createSkillIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyMarkdown: 'Review preferences',
        description: 'Reusable review preferences.',
        idempotencyKey: 'nightly:create_skill:code-review',
        name: 'code-review',
        proposalKey: 'agt_1:create_skill:skill:code-review',
        title: 'Code Review',
        userId: 'user_1',
      }),
    );
    expect(replaceSkillContentCAS).not.toHaveBeenCalled();
    expect(result.proposal.status).toBe('applied');
    expect(result.proposal.applyAttempts?.[0].actionResults).toEqual([
      {
        idempotencyKey: 'nightly:create_skill:code-review',
        resourceId: 'adoc_created',
        status: 'deduped',
        summary: 'Skill already created.',
      },
    ]);
  });

  /**
   * @example
   * expect(result.proposal.conflictReason).toBe('document_changed');
   */
  it('skips stale proposal actions without calling safe tools', async () => {
    const createSkillIfAbsent = vi.fn();
    const replaceSkillContentCAS = vi.fn();
    const service = createMaintenanceProposalApplyService({
      checkAction: vi.fn().mockResolvedValue({ allowed: false, reason: 'document_changed' }),
      checkGates: vi.fn().mockResolvedValue({ allowed: true }),
      now: () => '2026-05-09T01:00:00.000Z',
      tools: {
        createSkillIfAbsent,
        replaceSkillContentCAS,
      },
      updateProposal: vi.fn(),
    });

    const result = await service.apply({
      agentId: 'agt_1',
      proposal: createProposal(),
      sourceId: 'nightly-review:user_1:agt_1:2026-05-09',
      sourceType: 'agent.nightly_review.requested',
      userId: 'user_1',
    });

    expect(createSkillIfAbsent).not.toHaveBeenCalled();
    expect(replaceSkillContentCAS).not.toHaveBeenCalled();
    expect(result.proposal.status).toBe('stale');
    expect(result.proposal.conflictReason).toBe('document_changed');
    expect(result.proposal.applyAttempts?.[0].actionResults[0]).toMatchObject({
      idempotencyKey: 'nightly:refine_skill:adoc_1',
      status: 'skipped_stale',
    });
    expect(spanSetAttribute).toHaveBeenCalledWith('agent.signal.proposal.apply_status', 'stale');
    expect(spanSetAttribute).toHaveBeenCalledWith(
      'agent.signal.proposal.conflict_reason',
      'document_changed',
    );
    expect(spanSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  /**
   * @example
   * expect(result.proposal.applyAttempts?.[0].actionResults[0].status).toBe('skipped_unsupported');
   */
  it('records unsupported actions without applying them', async () => {
    const createSkillIfAbsent = vi.fn();
    const replaceSkillContentCAS = vi.fn();
    const service = createMaintenanceProposalApplyService({
      checkAction: vi.fn().mockResolvedValue({ allowed: false, reason: 'unsupported' }),
      checkGates: vi.fn().mockResolvedValue({ allowed: true }),
      now: () => '2026-05-09T01:00:00.000Z',
      tools: {
        createSkillIfAbsent,
        replaceSkillContentCAS,
      },
      updateProposal: vi.fn(),
    });

    const result = await service.apply({
      agentId: 'agt_1',
      proposal: createProposal({
        actionType: 'consolidate_skill',
        actions: [
          {
            actionType: 'consolidate_skill',
            evidenceRefs: [],
            idempotencyKey: 'nightly:consolidate_skill:adoc_1',
            rationale: 'Merge overlapping skills.',
            risk: MaintenanceRisk.High,
            target: { skillDocumentId: 'adoc_1' },
          },
        ],
      }),
      sourceId: 'nightly-review:user_1:agt_1:2026-05-09',
      sourceType: 'agent.nightly_review.requested',
      userId: 'user_1',
    });

    expect(createSkillIfAbsent).not.toHaveBeenCalled();
    expect(replaceSkillContentCAS).not.toHaveBeenCalled();
    expect(result.proposal.status).toBe('failed');
    expect(result.proposal.applyAttempts?.[0].actionResults).toEqual([
      {
        idempotencyKey: 'nightly:consolidate_skill:adoc_1',
        status: 'skipped_unsupported',
        summary: 'Proposal action is not supported by approve-time apply.',
      },
    ]);
  });
});
