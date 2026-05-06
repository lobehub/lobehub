import { describe, expect, it } from 'vitest';

import { createMaintenancePlannerService } from '../planner';
import { MaintenanceApplyMode, MaintenanceReviewScope, MaintenanceRisk } from '../types';

describe('maintenancePlannerService', () => {
  /**
   * @example
   * A high-confidence explicit preference with evidence becomes an auto-apply memory action.
   */
  it('normalizes an evidence-backed memory draft into an executable action', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'write_memory',
            confidence: 0.94,
            evidenceRefs: [
              {
                id: 'msg-1',
                summary: 'User explicitly asked for concise PR summaries',
                type: 'message',
              },
            ],
            policyHints: {
              evidenceStrength: 'strong',
              persistence: 'stable',
              sensitivity: 'normal',
              userExplicitness: 'explicit',
            },
            rationale: 'The user stated a stable preference that should affect future responses.',
            target: { topicIds: ['topic-1'] },
            value: { content: 'User prefers concise PR summaries.' },
          },
        ],
        findings: [
          {
            evidenceRefs: [{ id: 'msg-1', type: 'message' }],
            severity: 'medium',
            summary: 'Stable preference found',
          },
        ],
        summary: 'One stable preference should be remembered.',
      },
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      actionType: 'write_memory',
      applyMode: MaintenanceApplyMode.AutoApply,
      dedupeKey: 'memory:User prefers concise PR summaries.',
      idempotencyKey:
        'nightly-review:user-1:agent-1:2026-05-04:write_memory:memory:User prefers concise PR summaries.',
      operation: {
        input: { content: 'User prefers concise PR summaries.', userId: 'user-1' },
      },
      risk: MaintenanceRisk.Low,
    });
  });

  /**
   * @example
   * A high-confidence inferred memory with evidence still cannot bypass memory mutation policy.
   */
  it('keeps inferred high-confidence memory drafts as proposals', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'write_memory',
            confidence: 0.94,
            evidenceRefs: [{ id: 'msg-1', summary: 'User might prefer Python.', type: 'message' }],
            policyHints: {
              evidenceStrength: 'medium',
              persistence: 'stable',
              sensitivity: 'normal',
              userExplicitness: 'inferred',
            },
            rationale: 'The user seemed to prefer Python for future tasks.',
            value: { content: 'User prefers Python.' },
          },
        ],
        findings: [],
        summary: 'Inferred preference candidate.',
      },
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    expect(plan.actions[0]).toMatchObject({
      actionType: 'write_memory',
      applyMode: MaintenanceApplyMode.ProposalOnly,
      risk: MaintenanceRisk.Medium,
    });
  });

  /**
   * @example
   * Sensitive memory candidates stay out of automatic writes even with high reviewer confidence.
   */
  it('keeps sensitive high-confidence memory drafts as proposals', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'write_memory',
            confidence: 0.96,
            evidenceRefs: [
              { id: 'msg-1', summary: 'User mentioned health context.', type: 'message' },
            ],
            policyHints: {
              evidenceStrength: 'strong',
              persistence: 'stable',
              sensitivity: 'sensitive',
              userExplicitness: 'explicit',
            },
            rationale: 'The user explicitly mentioned a health detail.',
            value: { content: 'User has a health-related constraint.' },
          },
        ],
        findings: [],
        summary: 'Sensitive memory candidate.',
      },
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    expect(plan.actions[0]).toMatchObject({
      actionType: 'write_memory',
      applyMode: MaintenanceApplyMode.ProposalOnly,
      risk: MaintenanceRisk.High,
    });
  });

  /**
   * @example
   * Skill creation requires explicit strong evidence instead of confidence alone.
   */
  it('keeps implicit skill creation drafts as proposals', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'create_skill',
            confidence: 0.93,
            evidenceRefs: [{ id: 'receipt-1', type: 'receipt' }],
            policyHints: {
              evidenceStrength: 'medium',
              mutationScope: 'small',
              userExplicitness: 'implicit',
            },
            rationale: 'A reusable workflow might be useful.',
            value: { bodyMarkdown: 'Use this workflow next time.', title: 'Workflow helper' },
          },
        ],
        findings: [],
        summary: 'Possible skill candidate.',
      },
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    expect(plan.actions[0]).toMatchObject({
      actionType: 'create_skill',
      applyMode: MaintenanceApplyMode.ProposalOnly,
      risk: MaintenanceRisk.Medium,
    });
  });

  /**
   * @example
   * Agent-declared self-iteration intent remains eligible for automatic skill creation.
   */
  it('allows explicit self-iteration skill creation with strong evidence', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'create_skill',
            confidence: 0.94,
            evidenceRefs: [
              { id: 'source-1', type: 'source' },
              { id: 'receipt-1', type: 'receipt' },
            ],
            policyHints: {
              evidenceStrength: 'strong',
              mutationScope: 'small',
              userExplicitness: 'explicit',
            },
            rationale: 'The running agent explicitly requested a reusable skill.',
            value: { bodyMarkdown: 'Use this workflow next time.', title: 'Workflow helper' },
          },
        ],
        findings: [],
        summary: 'Explicit skill candidate.',
      },
      reviewScope: MaintenanceReviewScope.SelfIterationIntent,
      sourceId: 'self-iteration-intent:user-1:agent-1:topic:topic-1:tool-1',
      userId: 'user-1',
    });

    expect(plan.actions[0]).toMatchObject({
      actionType: 'create_skill',
      applyMode: MaintenanceApplyMode.AutoApply,
      operation: {
        input: { bodyMarkdown: 'Use this workflow next time.', title: 'Workflow helper' },
      },
      risk: MaintenanceRisk.Low,
    });
  });

  /**
   * @example
   * Repeated tool failures can justify a small targeted managed-skill refinement.
   */
  it('allows repeated-failure skill refinement with strong evidence', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'refine_skill',
            confidence: 0.91,
            evidenceRefs: [
              { id: 'tool-fail-1', type: 'tool_call' },
              { id: 'tool-fail-2', type: 'tool_call' },
            ],
            policyHints: {
              evidenceStrength: 'strong',
              mutationScope: 'small',
              userExplicitness: 'implicit',
            },
            rationale: 'Repeated release-note validation failures reveal a small missing step.',
            target: { skillDocumentId: 'skill-release-notes' },
            value: {
              patch: 'Add a checklist step to validate changelog sections before publishing.',
              skillDocumentId: 'skill-release-notes',
            },
          },
        ],
        findings: [],
        summary: 'Repeated skill gap.',
      },
      reviewScope: MaintenanceReviewScope.SelfReflection,
      sourceId: 'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04',
      userId: 'user-1',
    });

    expect(plan.actions[0]).toMatchObject({
      actionType: 'refine_skill',
      applyMode: MaintenanceApplyMode.AutoApply,
      operation: {
        input: {
          patch: 'Add a checklist step to validate changelog sections before publishing.',
          skillDocumentId: 'skill-release-notes',
        },
      },
      risk: MaintenanceRisk.Low,
    });
  });

  /**
   * @example
   * Weak single-signal memory drafts are downgraded and cannot auto-write.
   */
  it('downgrades weak or evidence-free drafts to proposal or noop', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'write_memory',
            confidence: 0.51,
            evidenceRefs: [],
            rationale: 'Maybe the user likes dark UI.',
            value: { content: 'User likes dark UI.' },
          },
        ],
        findings: [],
        summary: 'Weak memory candidate.',
      },
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    expect(plan.actions[0]).toMatchObject({
      actionType: 'write_memory',
      applyMode: MaintenanceApplyMode.Skip,
      risk: MaintenanceRisk.High,
    });
  });

  /**
   * @example
   * Self-reflection never auto-consolidates skills.
   */
  it('forces self-reflection consolidation drafts into proposal-only', () => {
    const planner = createMaintenancePlannerService();

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'consolidate_skill',
            confidence: 0.99,
            evidenceRefs: [
              { id: 'skill-a', type: 'agent_document' },
              { id: 'skill-b', type: 'agent_document' },
            ],
            rationale: 'Two skills overlap.',
            target: { skillDocumentId: 'skill-a' },
            value: { sourceSkillIds: ['skill-a', 'skill-b'] },
          },
        ],
        findings: [],
        summary: 'Overlap found.',
      },
      reviewScope: MaintenanceReviewScope.SelfReflection,
      sourceId:
        'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
      userId: 'user-1',
    });

    expect(plan.actions[0]).toMatchObject({
      actionType: 'consolidate_skill',
      applyMode: MaintenanceApplyMode.ProposalOnly,
      risk: MaintenanceRisk.High,
    });
  });

  /**
   * @example
   * Planner caps auto-apply actions so one review cannot mutate too much.
   */
  it('caps automatic actions and skips overflow actions', () => {
    const planner = createMaintenancePlannerService({ maxAutoApplyActions: 1 });

    const plan = planner.plan({
      draft: {
        actions: [
          {
            actionType: 'write_memory',
            confidence: 0.95,
            evidenceRefs: [{ id: 'msg-1', type: 'message' }],
            policyHints: {
              evidenceStrength: 'strong',
              persistence: 'stable',
              sensitivity: 'normal',
              userExplicitness: 'explicit',
            },
            rationale: 'Preference A.',
            value: { content: 'User prefers A.' },
          },
          {
            actionType: 'write_memory',
            confidence: 0.95,
            evidenceRefs: [{ id: 'msg-2', type: 'message' }],
            policyHints: {
              evidenceStrength: 'strong',
              persistence: 'stable',
              sensitivity: 'normal',
              userExplicitness: 'explicit',
            },
            rationale: 'Preference B.',
            value: { content: 'User prefers B.' },
          },
        ],
        findings: [],
        summary: 'Two candidates.',
      },
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    expect(plan.actions.map((action) => action.applyMode)).toEqual([
      MaintenanceApplyMode.AutoApply,
      MaintenanceApplyMode.ProposalOnly,
    ]);
  });
});
