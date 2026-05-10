import { describe, expect, it } from 'vitest';

import type { MaintenanceProposalMetadata, MaintenanceProposalPlan } from '../proposal';
import {
  buildMaintenanceProposalFromPlan,
  buildMaintenanceProposalKey,
  getNextProposalExpiry,
  isMaintenanceProposalMetadata,
  refreshMaintenanceProposal,
  shouldRefreshMaintenanceProposal,
  shouldSupersedeMaintenanceProposal,
  supersedeMaintenanceProposal,
} from '../proposal';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
} from '../types';

const validProposalMetadata = (
  overrides: Partial<MaintenanceProposalMetadata> = {},
): MaintenanceProposalMetadata => ({
  actions: [
    {
      actionType: 'refine_skill',
      evidenceRefs: [{ id: 'topic_1', type: 'topic' }],
      idempotencyKey: 'source:refine_skill:skill:adoc_1',
      rationale: 'Refine the skill.',
      risk: MaintenanceRisk.Medium,
      target: { skillDocumentId: 'adoc_1' },
    },
  ],
  actionType: 'refine_skill',
  createdAt: '2026-05-09T00:00:00.000Z',
  evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
  evidenceWindowStart: '2026-05-09T00:00:00.000Z',
  expiresAt: '2026-05-12T00:00:00.000Z',
  proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
  status: 'pending',
  updatedAt: '2026-05-09T00:00:00.000Z',
  version: 1,
  ...overrides,
});

const malformedProposalMetadata = (overrides: Record<string, unknown>) => ({
  ...validProposalMetadata(),
  ...overrides,
});

describe('maintenance proposal metadata', () => {
  /**
   * @example
   * buildMaintenanceProposalKey({ agentId: 'agt_1', actionType: 'refine_skill' })
   * returns a deterministic key scoped to target identity.
   */
  it('builds a stable proposal key from target identity', () => {
    expect(
      buildMaintenanceProposalKey({
        actionType: 'refine_skill',
        agentId: 'agt_1',
        targetId: 'adoc_1',
        targetType: 'agent_document',
      }),
    ).toBe('agt_1:refine_skill:agent_document:adoc_1');
  });

  /**
   * @example
   * getNextProposalExpiry({ createdAt, now }) extends by 72h without exceeding 7d.
   */
  it('extends expiry with a sliding window but keeps a hard cap', () => {
    expect(
      getNextProposalExpiry({
        createdAt: '2026-05-09T00:00:00.000Z',
        now: '2026-05-10T00:00:00.000Z',
      }),
    ).toBe('2026-05-13T00:00:00.000Z');

    expect(
      getNextProposalExpiry({
        createdAt: '2026-05-09T00:00:00.000Z',
        now: '2026-05-15T12:00:00.000Z',
      }),
    ).toBe('2026-05-16T00:00:00.000Z');
  });

  /**
   * @example
   * shouldRefreshMaintenanceProposal({ existing: pendingSameKey }) returns refresh true.
   */
  it('refreshes only compatible pending proposals before expiry', () => {
    expect(
      shouldRefreshMaintenanceProposal({
        existing: {
          actionType: 'refine_skill',
          expiresAt: '2026-05-12T00:00:00.000Z',
          proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
          status: 'pending',
        },
        incoming: {
          actionType: 'refine_skill',
          proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
        },
        now: '2026-05-10T00:00:00.000Z',
      }),
    ).toEqual({ refresh: true });
  });

  /**
   * @example
   * shouldSupersedeMaintenanceProposal({ existing, incoming }) returns supersede true for incompatible operations.
   */
  it('supersedes incompatible pending proposals with the same key', () => {
    expect(
      shouldSupersedeMaintenanceProposal({
        existing: validProposalMetadata({
          actions: [
            {
              actionType: 'refine_skill',
              evidenceRefs: [],
              idempotencyKey: 'old',
              operation: {
                domain: 'skill',
                input: { patch: 'old', skillDocumentId: 'adoc_1', userId: 'user_1' },
                operation: 'refine',
              },
              rationale: 'old rationale',
              risk: MaintenanceRisk.Medium,
              target: { skillDocumentId: 'adoc_1' },
            },
          ],
        }),
        incoming: validProposalMetadata({
          actions: [
            {
              actionType: 'create_skill',
              evidenceRefs: [],
              idempotencyKey: 'new',
              operation: {
                domain: 'skill',
                input: { bodyMarkdown: 'new', name: 'new-skill', userId: 'user_1' },
                operation: 'create',
              },
              rationale: 'new rationale',
              risk: MaintenanceRisk.Medium,
              target: { skillName: 'new-skill' },
            },
          ],
        }),
        now: '2026-05-10T00:00:00.000Z',
      }),
    ).toEqual({ supersede: true });
  });

  /**
   * @example
   * shouldSupersedeMaintenanceProposal({ existing, incoming }) ignores rationale-only changes.
   */
  it('keeps equivalent operations compatible even when rationale changes', () => {
    const existing = validProposalMetadata({
      actions: [
        {
          actionType: 'refine_skill',
          evidenceRefs: [],
          idempotencyKey: 'old',
          operation: {
            domain: 'skill',
            input: { patch: 'old', skillDocumentId: 'adoc_1', userId: 'user_1' },
            operation: 'refine',
          },
          rationale: 'old rationale',
          risk: MaintenanceRisk.Medium,
          target: { skillDocumentId: 'adoc_1' },
        },
      ],
    });
    const incoming = validProposalMetadata({
      actions: [
        {
          actionType: 'refine_skill',
          evidenceRefs: [],
          idempotencyKey: 'new',
          operation: {
            domain: 'skill',
            input: { patch: 'new', skillDocumentId: 'adoc_1', userId: 'user_1' },
            operation: 'refine',
          },
          rationale: 'new rationale',
          risk: MaintenanceRisk.Medium,
          target: { skillDocumentId: 'adoc_1' },
        },
      ],
    });

    expect(
      shouldSupersedeMaintenanceProposal({
        existing,
        incoming,
        now: '2026-05-10T00:00:00.000Z',
      }),
    ).toEqual({ reason: 'compatible', supersede: false });
  });

  /**
   * @example
   * refreshMaintenanceProposal({ existing, incoming }) preserves createdAt and refreshes expiry.
   */
  it('refreshes proposal actions and expiry while preserving proposal identity', () => {
    const existing = validProposalMetadata({
      createdAt: '2026-05-09T00:00:00.000Z',
      expiresAt: '2026-05-12T00:00:00.000Z',
    });
    const incoming = validProposalMetadata({
      actions: [
        {
          actionType: 'refine_skill',
          evidenceRefs: [{ id: 'msg_new', type: 'message' }],
          idempotencyKey: 'new',
          rationale: 'new rationale',
          risk: MaintenanceRisk.Medium,
          target: { skillDocumentId: 'adoc_1' },
        },
      ],
      evidenceWindowEnd: '2026-05-10T01:00:00.000Z',
      evidenceWindowStart: '2026-05-10T00:00:00.000Z',
    });

    expect(
      refreshMaintenanceProposal({
        existing,
        incoming,
        now: '2026-05-10T00:00:00.000Z',
      }),
    ).toMatchObject({
      actions: incoming.actions,
      createdAt: '2026-05-09T00:00:00.000Z',
      evidenceWindowEnd: '2026-05-10T01:00:00.000Z',
      expiresAt: '2026-05-13T00:00:00.000Z',
      proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
      status: 'pending',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });
  });

  /**
   * @example
   * supersedeMaintenanceProposal({ existing, supersededBy }) marks the old proposal inactive.
   */
  it('marks superseded proposals with replacement identity', () => {
    expect(
      supersedeMaintenanceProposal({
        existing: validProposalMetadata(),
        now: '2026-05-10T00:00:00.000Z',
        supersededBy: 'brief_new',
      }),
    ).toMatchObject({
      status: 'superseded',
      supersededBy: 'brief_new',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });
  });

  /**
   * @example
   * isMaintenanceProposalMetadata({ status: 'pending' }) returns false.
   */
  it('does not accept arbitrary metadata as proposal metadata', () => {
    expect(isMaintenanceProposalMetadata({ status: 'pending' })).toBe(false);
    expect(isMaintenanceProposalMetadata(validProposalMetadata({ actions: [] }))).toBe(true);
    expect(
      isMaintenanceProposalMetadata(malformedProposalMetadata({ actionType: 'delete_everything' })),
    ).toBe(false);
    expect(isMaintenanceProposalMetadata(malformedProposalMetadata({ status: 'archived' }))).toBe(
      false,
    );
  });

  /**
   * @example
   * isMaintenanceProposalMetadata({ actions: [{}] }) returns false.
   */
  it('rejects malformed proposal action metadata entries', () => {
    const validAction = validProposalMetadata().actions[0];
    const malformedProposalAction = (overrides: Record<string, unknown>) =>
      malformedProposalMetadata({ actions: [{ ...validAction, ...overrides }] });

    expect(isMaintenanceProposalMetadata(malformedProposalMetadata({ actions: [{}] }))).toBe(false);
    expect(
      isMaintenanceProposalMetadata(malformedProposalAction({ evidenceRefs: undefined })),
    ).toBe(false);
    expect(
      isMaintenanceProposalMetadata(malformedProposalAction({ idempotencyKey: undefined })),
    ).toBe(false);
    expect(isMaintenanceProposalMetadata(malformedProposalAction({ rationale: undefined }))).toBe(
      false,
    );
    expect(isMaintenanceProposalMetadata(malformedProposalAction({ risk: undefined }))).toBe(false);
    expect(
      isMaintenanceProposalMetadata(malformedProposalAction({ actionType: 'delete_everything' })),
    ).toBe(false);
    expect(isMaintenanceProposalMetadata(malformedProposalAction({ risk: 'critical' }))).toBe(
      false,
    );
  });

  /**
   * @example
   * buildMaintenanceProposalFromPlan({ plan }) stores the complete refine base snapshot.
   */
  it('stores complete base snapshots on mergeable refine_skill proposals', () => {
    const action = {
      actionType: 'refine_skill' as const,
      applyMode: MaintenanceApplyMode.ProposalOnly,
      baseSnapshot: {
        agentDocumentId: 'adoc_1',
        contentHash: 'sha256:base',
        documentId: 'doc_1',
        managed: true,
        targetType: 'skill' as const,
        writable: true,
      },
      confidence: 0.92,
      dedupeKey: 'skill:adoc_1',
      evidenceRefs: [{ id: 'topic_1', type: 'topic' as const }],
      idempotencyKey: 'source:refine_skill:skill:adoc_1',
      operation: {
        domain: 'skill' as const,
        input: {
          bodyMarkdown: 'Updated review preferences.',
          skillDocumentId: 'adoc_1',
          userId: 'user_1',
        },
        operation: 'refine' as const,
      },
      rationale: 'Refine the reusable review skill.',
      risk: MaintenanceRisk.Medium,
      target: { skillDocumentId: 'adoc_1' },
    };
    const proposal = buildMaintenanceProposalFromPlan({
      agentId: 'agt_1',
      evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
      evidenceWindowStart: '2026-05-09T00:00:00.000Z',
      now: '2026-05-09T00:00:00.000Z',
      plan: {
        actions: [action],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Review found a skill refinement proposal.',
      },
      results: [
        {
          idempotencyKey: 'source:refine_skill:skill:adoc_1',
          status: MaintenanceActionStatus.Proposed,
        },
      ],
    });

    expect(proposal?.actions[0].baseSnapshot).toEqual({
      agentDocumentId: 'adoc_1',
      contentHash: 'sha256:base',
      documentId: 'doc_1',
      managed: true,
      targetType: 'skill',
      writable: true,
    });
  });

  /**
   * @example
   * buildMaintenanceProposalFromPlan({ plan: missingSnapshotPlan }) throws before storing.
   */
  it('rejects mergeable refine_skill proposal actions without required base snapshots', () => {
    const buildProposal = (action: {
      actionType: 'refine_skill';
      baseSnapshot?: {
        agentDocumentId?: string;
        contentHash?: string;
        documentId?: string;
        managed?: boolean;
        targetType?: 'skill';
        writable?: boolean;
      };
    }) => {
      const malformedPlan: unknown = {
        actions: [
          {
            ...action,
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.92,
            dedupeKey: 'skill:adoc_1',
            evidenceRefs: [{ id: 'topic_1', type: 'topic' }],
            idempotencyKey: 'source:refine_skill:skill:adoc_1',
            operation: {
              domain: 'skill',
              input: {
                bodyMarkdown: 'Updated review preferences.',
                skillDocumentId: 'adoc_1',
                userId: 'user_1',
              },
              operation: 'refine',
            },
            rationale: 'Refine the reusable review skill.',
            risk: MaintenanceRisk.Medium,
            target: { skillDocumentId: 'adoc_1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Review found a skill refinement proposal.',
      };

      return buildMaintenanceProposalFromPlan({
        agentId: 'agt_1',
        evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
        evidenceWindowStart: '2026-05-09T00:00:00.000Z',
        now: '2026-05-09T00:00:00.000Z',
        // NOTICE:
        // This intentionally bypasses the compile-time snapshot requirement.
        // The test exercises runtime validation for malformed persisted/runtime proposal data.
        // Remove this cast when malformed projection plans can no longer reach this boundary.
        plan: malformedPlan as unknown as MaintenanceProposalPlan,
        results: [
          {
            idempotencyKey: 'source:refine_skill:skill:adoc_1',
            status: MaintenanceActionStatus.Proposed,
          },
        ],
      });
    };

    expect(() => buildProposal({ actionType: 'refine_skill' })).toThrow(
      'Mergeable proposal action requires a complete base snapshot. actionType=refine_skill',
    );
    expect(() =>
      buildProposal({
        actionType: 'refine_skill',
        baseSnapshot: {
          agentDocumentId: 'adoc_1',
          documentId: 'doc_1',
          managed: true,
          targetType: 'skill',
          writable: true,
        },
      }),
    ).toThrow(
      'Mergeable proposal action requires a complete base snapshot. actionType=refine_skill',
    );
  });

  /**
   * @example
   * buildMaintenanceProposalFromPlan({ plan }) stores the absent create snapshot.
   */
  it('accepts complete absent snapshots on mergeable create_skill proposals', () => {
    const action = {
      actionType: 'create_skill' as const,
      applyMode: MaintenanceApplyMode.ProposalOnly,
      baseSnapshot: {
        absent: true,
        skillName: 'code-review',
        targetType: 'skill' as const,
      },
      confidence: 0.92,
      dedupeKey: 'skill:code-review',
      evidenceRefs: [{ id: 'topic_1', type: 'topic' as const }],
      idempotencyKey: 'source:create_skill:skill:code-review',
      operation: {
        domain: 'skill' as const,
        input: {
          bodyMarkdown: 'Remember review preferences.',
          name: 'code-review',
          title: 'Code Review',
          userId: 'user_1',
        },
        operation: 'create' as const,
      },
      rationale: 'Create a reusable review skill.',
      risk: MaintenanceRisk.Medium,
      target: { skillName: 'code-review' },
    };
    const proposal = buildMaintenanceProposalFromPlan({
      agentId: 'agt_1',
      evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
      evidenceWindowStart: '2026-05-09T00:00:00.000Z',
      now: '2026-05-09T00:00:00.000Z',
      plan: {
        actions: [action],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Review found a skill creation proposal.',
      },
      results: [
        {
          idempotencyKey: 'source:create_skill:skill:code-review',
          status: MaintenanceActionStatus.Proposed,
        },
      ],
    });

    expect(proposal?.actions[0].baseSnapshot).toEqual({
      absent: true,
      skillName: 'code-review',
      targetType: 'skill',
    });
  });

  /**
   * @example
   * buildMaintenanceProposalFromPlan({ plan: incompleteAbsentSnapshotPlan }) throws.
   */
  it('rejects missing or incomplete absent snapshots on mergeable create_skill proposals', () => {
    const buildProposal = (action: {
      actionType: 'create_skill';
      baseSnapshot?: {
        absent?: boolean;
        skillName?: string;
        targetType?: 'skill';
      };
    }) => {
      const malformedPlan: unknown = {
        actions: [
          {
            ...action,
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.92,
            dedupeKey: 'skill:code-review',
            evidenceRefs: [{ id: 'topic_1', type: 'topic' }],
            idempotencyKey: 'source:create_skill:skill:code-review',
            operation: {
              domain: 'skill',
              input: {
                bodyMarkdown: 'Remember review preferences.',
                name: 'code-review',
                userId: 'user_1',
              },
              operation: 'create',
            },
            rationale: 'Create a reusable review skill.',
            risk: MaintenanceRisk.Medium,
            target: { skillName: 'code-review' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Review found a skill creation proposal.',
      };

      return buildMaintenanceProposalFromPlan({
        agentId: 'agt_1',
        evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
        evidenceWindowStart: '2026-05-09T00:00:00.000Z',
        now: '2026-05-09T00:00:00.000Z',
        // NOTICE:
        // This intentionally bypasses the compile-time snapshot requirement.
        // The test exercises runtime validation for malformed persisted/runtime proposal data.
        // Remove this cast when malformed projection plans can no longer reach this boundary.
        plan: malformedPlan as unknown as MaintenanceProposalPlan,
        results: [
          {
            idempotencyKey: 'source:create_skill:skill:code-review',
            status: MaintenanceActionStatus.Proposed,
          },
        ],
      });
    };

    expect(() => buildProposal({ actionType: 'create_skill' })).toThrow(
      'Mergeable proposal action requires a complete base snapshot. actionType=create_skill',
    );
    expect(() =>
      buildProposal({
        actionType: 'create_skill',
        baseSnapshot: {
          absent: true,
          targetType: 'skill',
        },
      }),
    ).toThrow(
      'Mergeable proposal action requires a complete base snapshot. actionType=create_skill',
    );
  });

  /**
   * @example
   * buildMaintenanceProposalFromPlan({ plan }) keeps target title fallback for consolidate actions.
   */
  it('stores targetTitle fallback on non-mergeable skill proposals', () => {
    const proposal = buildMaintenanceProposalFromPlan({
      agentId: 'agt_1',
      evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
      evidenceWindowStart: '2026-05-09T00:00:00.000Z',
      now: '2026-05-09T00:00:00.000Z',
      plan: {
        actions: [
          {
            actionType: 'consolidate_skill',
            applyMode: MaintenanceApplyMode.ProposalOnly,
            confidence: 0.92,
            dedupeKey: 'skill:review-practices',
            evidenceRefs: [{ id: 'topic_1', type: 'topic' }],
            idempotencyKey: 'source:consolidate_skill:skill:review-practices',
            operation: {
              domain: 'skill',
              input: {
                approval: { source: 'proposal' },
                canonicalSkillDocumentId: 'adoc_1',
                sourceSkillIds: ['adoc_2'],
                userId: 'user_1',
              },
              operation: 'consolidate',
            },
            rationale: 'Consolidate overlapping review skills.',
            risk: MaintenanceRisk.Medium,
            target: { skillName: 'Review Practices' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: MaintenanceReviewScope.Nightly,
        summary: 'Review found a skill consolidation proposal.',
      },
      results: [
        {
          idempotencyKey: 'source:consolidate_skill:skill:review-practices',
          status: MaintenanceActionStatus.Proposed,
        },
      ],
    });

    expect(proposal?.actions[0].baseSnapshot).toEqual({
      targetTitle: 'Review Practices',
    });
  });

  /**
   * @example
   * buildMaintenanceProposalFromPlan({ plan: noopPlan }) returns undefined for proposed noop actions.
   */
  it('does not build proposal metadata from proposed noop actions', () => {
    expect(
      buildMaintenanceProposalFromPlan({
        agentId: 'agt_1',
        evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
        evidenceWindowStart: '2026-05-09T00:00:00.000Z',
        now: '2026-05-09T00:00:00.000Z',
        plan: {
          actions: [
            {
              actionType: 'noop',
              applyMode: MaintenanceApplyMode.ProposalOnly,
              confidence: 0.92,
              dedupeKey: 'noop:quiet',
              evidenceRefs: [{ id: 'topic_1', type: 'topic' }],
              idempotencyKey: 'source:noop:quiet',
              rationale: 'No maintenance change is needed.',
              risk: MaintenanceRisk.Low,
            },
          ],
          plannerVersion: 'test-planner',
          reviewScope: MaintenanceReviewScope.Nightly,
          summary: 'Review found no actionable proposal.',
        },
        results: [
          {
            idempotencyKey: 'source:noop:quiet',
            status: MaintenanceActionStatus.Proposed,
          },
        ],
      }),
    ).toBeUndefined();
  });
});
