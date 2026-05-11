import { describe, expect, it } from 'vitest';

import {
  projectMaintenanceToolOutcomes,
  projectMaintenanceToolRuntimeRun,
} from '../briefProjection';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
  ReviewRunStatus,
} from '../types';

describe('projectMaintenanceToolOutcomes', () => {
  /**
   * @example
   * Empty tool outcome lists stay silent and carry empty metadata.
   */
  it('does not request a brief when no write tools ran', () => {
    const projection = projectMaintenanceToolOutcomes({ outcomes: [] });

    expect(projection).toEqual({
      actionCounts: { applied: 0, failed: 0, proposed: 0, skipped: 0 },
      actions: [],
      briefKind: 'none',
      proposalCount: 0,
      receiptIds: [],
    });
  });

  /**
   * @example
   * Applied write-tool outcomes become insight metadata with durable receipt links.
   */
  it('projects applied writes to insight metadata with action and receipt ids', () => {
    const projection = projectMaintenanceToolOutcomes({
      outcomes: [
        {
          receiptId: 'receipt-1',
          resourceId: 'memory-1',
          status: 'applied',
          summary: 'Saved concise preference.',
          toolName: 'writeMemory',
        },
      ],
    });

    expect(projection).toEqual({
      actionCounts: { applied: 1, failed: 0, proposed: 0, skipped: 0 },
      actions: [
        {
          receiptId: 'receipt-1',
          resourceId: 'memory-1',
          status: 'applied',
          summary: 'Saved concise preference.',
          toolName: 'writeMemory',
        },
      ],
      briefKind: 'insight',
      proposalCount: 0,
      receiptIds: ['receipt-1'],
    });
  });

  /**
   * @example
   * Proposal lifecycle tool outcomes stay silent because they mutate proposal state, not resources.
   */
  it('keeps proposal lifecycle outcomes out of resource decision metadata', () => {
    const projection = projectMaintenanceToolOutcomes({
      outcomes: [
        {
          receiptId: 'receipt-created',
          resourceId: 'proposal-1',
          status: 'proposed',
          summary: 'Review new skill proposal.',
          toolName: 'createMaintenanceProposal',
        },
        {
          receiptId: 'receipt-refreshed',
          resourceId: 'proposal-2',
          status: 'proposed',
          summary: 'Review refreshed skill proposal.',
          toolName: 'refreshMaintenanceProposal',
        },
        {
          receiptId: 'receipt-superseded',
          resourceId: 'proposal-3',
          status: 'proposed',
          summary: 'Review superseding skill proposal.',
          toolName: 'supersedeMaintenanceProposal',
        },
      ],
    });

    expect(projection.briefKind).toBe('none');
    expect(projection.proposalCount).toBe(0);
    expect(projection.actionCounts).toEqual({
      applied: 0,
      failed: 0,
      proposed: 0,
      skipped: 0,
    });
    expect(projection.receiptIds).toEqual([
      'receipt-created',
      'receipt-refreshed',
      'receipt-superseded',
    ]);
  });

  /**
   * @example
   * Visible risky write outcomes create insight metadata when no decision exists.
   */
  it('projects stale and failed outcomes to insight metadata', () => {
    const projection = projectMaintenanceToolOutcomes({
      outcomes: [
        {
          receiptId: 'receipt-stale',
          status: 'skipped_stale',
          summary: 'Skill changed before apply.',
          toolName: 'replaceSkillContentCAS',
        },
        {
          status: 'failed',
          summary: 'Proposal close failed.',
          toolName: 'closeMaintenanceProposal',
        },
      ],
    });

    expect(projection.briefKind).toBe('insight');
    expect(projection.actionCounts).toEqual({
      applied: 0,
      failed: 1,
      proposed: 0,
      skipped: 1,
    });
    expect(projection.receiptIds).toEqual(['receipt-stale']);
  });

  /**
   * @example
   * Unsupported and deduped writes are retained as metadata but stay brief-silent.
   */
  it('keeps skipped unsupported and deduped outcomes silent when they are the only outcomes', () => {
    const projection = projectMaintenanceToolOutcomes({
      outcomes: [
        {
          receiptId: 'receipt-unsupported',
          status: 'skipped_unsupported',
          summary: 'Tool disabled.',
          toolName: 'createSkillIfAbsent',
        },
        {
          status: 'deduped',
          summary: 'Duplicate operation.',
          toolName: 'refreshMaintenanceProposal',
        },
      ],
    });

    expect(projection.briefKind).toBe('none');
    expect(projection.actionCounts).toEqual({
      applied: 0,
      failed: 0,
      proposed: 0,
      skipped: 2,
    });
    expect(projection.receiptIds).toEqual(['receipt-unsupported']);
  });
});

describe('projectMaintenanceToolRuntimeRun', () => {
  /**
   * @example
   * projectMaintenanceToolRuntimeRun keeps createMaintenanceProposal action payloads approve-ready.
   */
  it('preserves proposed create skill actions from proposal lifecycle tool arguments', () => {
    const projection = projectMaintenanceToolRuntimeRun({
      content: 'Created a proposal.',
      includeProposalLifecycleActions: true,
      localDate: '2026-05-09',
      outcomes: [
        {
          receiptId: 'receipt-proposal-1',
          resourceId: 'brief-proposal-1',
          status: 'proposed',
          summary: 'Review concise answers skill.',
          toolName: 'createMaintenanceProposal',
        },
      ],
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'source-1',
      toolCalls: [
        {
          apiName: 'createMaintenanceProposal',
          arguments: JSON.stringify({
            actions: [
              {
                actionType: 'create_skill',
                applyMode: MaintenanceApplyMode.ProposalOnly,
                baseSnapshot: {
                  absent: true,
                  skillName: 'concise-answers',
                  targetType: 'skill',
                },
                confidence: 0.9,
                dedupeKey: 'skill:concise-answers',
                evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
                idempotencyKey: 'source-1:create_skill:concise-answers',
                operation: {
                  domain: 'skill',
                  input: {
                    bodyMarkdown: 'Prefer concise answers.',
                    name: 'concise-answers',
                    title: 'Concise answers',
                    userId: 'user-1',
                  },
                  operation: 'create',
                },
                rationale: 'User repeatedly asks for concise answers.',
                risk: MaintenanceRisk.Low,
                target: { skillName: 'concise-answers' },
              },
            ],
            idempotencyKey: 'proposal-op-1',
            proposalKey: 'agent-1:create_skill:skill:concise-answers',
            summary: 'Review concise answers skill.',
          }),
          id: 'call-proposal-1',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
      ],
      userId: 'user-1',
    });

    expect(projection.execution.actions).toEqual([
      {
        idempotencyKey: 'source-1:create_skill:concise-answers',
        receiptId: 'receipt-proposal-1',
        resourceId: 'brief-proposal-1',
        status: MaintenanceActionStatus.Proposed,
        summary: 'Review concise answers skill.',
      },
    ]);
    expect(projection.projectionPlan.actions).toHaveLength(1);
    expect(projection.projectionPlan.actions[0]).toMatchObject({
      actionType: 'create_skill',
      baseSnapshot: {
        absent: true,
        skillName: 'concise-answers',
        targetType: 'skill',
      },
      idempotencyKey: 'source-1:create_skill:concise-answers',
      operation: {
        domain: 'skill',
        operation: 'create',
      },
      target: { skillName: 'concise-answers' },
    });
  });

  /**
   * @example
   * projectMaintenanceToolRuntimeRun binds repeated same-name write outcomes by call order.
   */
  it('matches repeated same-name tool outcomes to their own ordered tool call arguments', () => {
    const projection = projectMaintenanceToolRuntimeRun({
      outcomes: [
        {
          receiptId: 'receipt-first',
          resourceId: 'skill-first',
          status: 'applied',
          toolName: 'createSkillIfAbsent',
        },
        {
          receiptId: 'receipt-second',
          resourceId: 'skill-second',
          status: 'applied',
          toolName: 'createSkillIfAbsent',
        },
      ],
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'source-1',
      toolCalls: [
        {
          apiName: 'createSkillIfAbsent',
          arguments: JSON.stringify({
            bodyMarkdown: 'First skill body.',
            idempotencyKey: 'op-first',
            name: 'first-skill',
          }),
          id: 'call-first',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
        {
          apiName: 'createSkillIfAbsent',
          arguments: JSON.stringify({
            bodyMarkdown: 'Second skill body.',
            idempotencyKey: 'op-second',
            name: 'second-skill',
          }),
          id: 'call-second',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
      ],
      userId: 'user-1',
    });

    expect(projection.execution.actions.map((action) => action.idempotencyKey)).toEqual([
      'op-first',
      'op-second',
    ]);
    expect(
      projection.projectionPlan.actions.map((action) => ({
        bodyMarkdown:
          action.operation?.domain === 'skill' && 'bodyMarkdown' in action.operation.input
            ? action.operation.input.bodyMarkdown
            : undefined,
        name:
          action.operation?.domain === 'skill' && 'name' in action.operation.input
            ? action.operation.input.name
            : undefined,
      })),
    ).toEqual([
      { bodyMarkdown: 'First skill body.', name: 'first-skill' },
      { bodyMarkdown: 'Second skill body.', name: 'second-skill' },
    ]);
  });

  /**
   * @example
   * projectMaintenanceToolRuntimeRun must not emit unapprovable proposal_only actions for refreshes.
   */
  it('does not project proposal refresh outcomes without executable actions into decision actions', () => {
    const projection = projectMaintenanceToolRuntimeRun({
      outcomes: [
        {
          receiptId: 'receipt-refresh',
          resourceId: 'brief-proposal-1',
          status: 'proposed',
          summary: 'Refreshed existing proposal.',
          toolName: 'refreshMaintenanceProposal',
        },
      ],
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'source-1',
      toolCalls: [
        {
          apiName: 'refreshMaintenanceProposal',
          arguments: JSON.stringify({
            idempotencyKey: 'refresh-op-1',
            proposalId: 'brief-proposal-1',
            summary: 'Refreshed existing proposal.',
          }),
          id: 'call-refresh-1',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
      ],
      userId: 'user-1',
    });

    expect(projection.projectionPlan.actions).toEqual([]);
    expect(projection.execution.actions).toEqual([]);
    expect(projection.execution.status).toBe(ReviewRunStatus.Skipped);
  });

  /**
   * @example
   * projectMaintenanceToolRuntimeRun must not turn malformed create proposal calls into approval work.
   */
  it('does not project create proposal outcomes without executable actions into decision actions', () => {
    const projection = projectMaintenanceToolRuntimeRun({
      outcomes: [
        {
          receiptId: 'receipt-create-proposal',
          resourceId: 'brief-proposal-1',
          status: 'proposed',
          summary: 'Malformed proposal.',
          toolName: 'createMaintenanceProposal',
        },
      ],
      includeProposalLifecycleActions: true,
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'source-1',
      toolCalls: [
        {
          apiName: 'createMaintenanceProposal',
          arguments: JSON.stringify({
            actions: [],
            idempotencyKey: 'create-proposal-op-1',
            proposalKey: 'agent-1:create_skill:skill:missing',
            summary: 'Malformed proposal.',
          }),
          id: 'call-create-proposal-1',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
      ],
      userId: 'user-1',
    });

    expect(projection.projectionPlan.actions).toEqual([]);
    expect(projection.execution.actions).toEqual([]);
    expect(projection.execution.status).toBe(ReviewRunStatus.Skipped);
  });

  /**
   * @example
   * projectMaintenanceToolRuntimeRun accepts proposal actions that inherit the proposal operation id.
   */
  it('projects proposal actions that omit per-action idempotency keys', () => {
    const projection = projectMaintenanceToolRuntimeRun({
      outcomes: [
        {
          receiptId: 'receipt-create-proposal',
          resourceId: 'brief-proposal-1',
          status: 'proposed',
          summary: 'Review managed skill refinement.',
          toolName: 'createMaintenanceProposal',
        },
      ],
      includeProposalLifecycleActions: true,
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'source-1',
      toolCalls: [
        {
          apiName: 'createMaintenanceProposal',
          arguments: JSON.stringify({
            actions: [
              {
                actionType: 'refine_skill',
                applyMode: MaintenanceApplyMode.ProposalOnly,
                baseSnapshot: {
                  agentDocumentId: 'skill-doc-1',
                  contentHash: 'hash-before',
                  documentId: 'doc-1',
                  managed: true,
                  targetType: 'skill',
                  writable: true,
                },
                operation: {
                  domain: 'skill',
                  input: {
                    bodyMarkdown: '# Updated skill\n\nUse the managed skill replacement path.',
                    skillDocumentId: 'skill-doc-1',
                    userId: 'user-1',
                  },
                  operation: 'refine',
                },
                rationale: 'The repeated failure needs a safe managed-skill refinement.',
                target: { skillDocumentId: 'skill-doc-1' },
              },
            ],
            idempotencyKey: 'proposal-op-1',
            proposalKey: 'agent-1:refine_skill:agent_document:skill-doc-1',
            summary: 'Review managed skill refinement.',
          }),
          id: 'call-create-proposal-1',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
      ],
      userId: 'user-1',
    });

    expect(projection.execution.actions).toEqual([
      {
        idempotencyKey: 'proposal-op-1:action:1',
        receiptId: 'receipt-create-proposal',
        resourceId: 'brief-proposal-1',
        status: MaintenanceActionStatus.Proposed,
        summary: 'Review managed skill refinement.',
      },
    ]);
    expect(projection.execution.status).toBe(ReviewRunStatus.Completed);
    expect(projection.projectionPlan.actions[0]).toMatchObject({
      actionType: 'refine_skill',
      idempotencyKey: 'proposal-op-1:action:1',
      operation: {
        domain: 'skill',
        operation: 'refine',
      },
      target: { skillDocumentId: 'skill-doc-1' },
    });
  });

  /**
   * @example
   * proposal_only actions are retained as ideas, not approve-time proposal actions.
   */
  it('extracts proposal-only actions as self-review ideas', () => {
    const projection = projectMaintenanceToolRuntimeRun({
      outcomes: [
        {
          receiptId: 'receipt-create-proposal',
          resourceId: 'brief-proposal-1',
          status: 'proposed',
          summary: 'Saved maintenance ideas.',
          toolName: 'createMaintenanceProposal',
        },
      ],
      includeProposalLifecycleActions: true,
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'source-1',
      toolCalls: [
        {
          apiName: 'createMaintenanceProposal',
          arguments: JSON.stringify({
            actions: [
              {
                actionType: 'proposal_only',
                evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
                idempotencyKey: 'idea-1',
                rationale: 'The skill layout may need a future split.',
                risk: MaintenanceRisk.Medium,
                target: { skillDocumentId: 'skill-doc-1' },
                title: 'Consider splitting review skill',
              },
            ],
            idempotencyKey: 'proposal-op-1',
            proposalKey: 'agent-1:proposal_only:agent_document:skill-doc-1',
            summary: 'Saved maintenance ideas.',
          }),
          id: 'call-create-proposal-1',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
      ],
      userId: 'user-1',
    });

    expect(projection.projectionPlan.actions).toEqual([]);
    expect(projection.ideas).toEqual([
      {
        evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
        idempotencyKey: 'idea-1',
        rationale: 'The skill layout may need a future split.',
        risk: MaintenanceRisk.Medium,
        target: { skillDocumentId: 'skill-doc-1' },
        title: 'Consider splitting review skill',
      },
    ]);
  });

  /**
   * @example
   * consolidate_skill proposal actions keep their frozen skill operation payload.
   */
  it('preserves consolidate skill proposal operations for approve-time apply', () => {
    const projection = projectMaintenanceToolRuntimeRun({
      outcomes: [
        {
          receiptId: 'receipt-create-proposal',
          resourceId: 'brief-proposal-1',
          status: 'proposed',
          summary: 'Review consolidated skill.',
          toolName: 'createMaintenanceProposal',
        },
      ],
      includeProposalLifecycleActions: true,
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'source-1',
      toolCalls: [
        {
          apiName: 'createMaintenanceProposal',
          arguments: JSON.stringify({
            actions: [
              {
                actionType: 'consolidate_skill',
                applyMode: MaintenanceApplyMode.ProposalOnly,
                baseSnapshot: {
                  agentDocumentId: 'skill-doc-1',
                  contentHash: 'hash-canonical',
                  documentId: 'doc-1',
                  managed: true,
                  targetType: 'skill',
                  writable: true,
                },
                evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
                operation: {
                  domain: 'skill',
                  input: {
                    bodyMarkdown: '# Review Skill\n\nUse one consolidated checklist.',
                    canonicalSkillDocumentId: 'skill-doc-1',
                    sourceSkillIds: ['skill-doc-1', 'skill-doc-2'],
                    sourceSnapshots: [
                      {
                        agentDocumentId: 'skill-doc-1',
                        contentHash: 'hash-canonical',
                        documentId: 'doc-1',
                        managed: true,
                        targetType: 'skill',
                        writable: true,
                      },
                      {
                        agentDocumentId: 'skill-doc-2',
                        contentHash: 'hash-source',
                        documentId: 'doc-2',
                        managed: true,
                        targetType: 'skill',
                        writable: true,
                      },
                    ],
                    userId: 'user-1',
                  },
                  operation: 'consolidate',
                },
                rationale: 'Two review skills overlap.',
                risk: MaintenanceRisk.Medium,
                target: { skillDocumentId: 'skill-doc-1' },
              },
            ],
            idempotencyKey: 'proposal-op-1',
            proposalKey: 'agent-1:consolidate_skill:agent_document:skill-doc-1',
            summary: 'Review consolidated skill.',
          }),
          id: 'call-create-proposal-1',
          identifier: 'agent-signal-maintenance',
          type: 'builtin',
        },
      ],
      userId: 'user-1',
    });

    expect(projection.projectionPlan.actions[0]).toMatchObject({
      actionType: 'consolidate_skill',
      baseSnapshot: {
        agentDocumentId: 'skill-doc-1',
        contentHash: 'hash-canonical',
      },
      operation: {
        domain: 'skill',
        input: {
          bodyMarkdown: '# Review Skill\n\nUse one consolidated checklist.',
          canonicalSkillDocumentId: 'skill-doc-1',
          sourceSkillIds: ['skill-doc-1', 'skill-doc-2'],
        },
        operation: 'consolidate',
      },
    });
    expect(projection.execution.actions[0]).toMatchObject({
      status: MaintenanceActionStatus.Proposed,
    });
  });
});
