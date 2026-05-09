import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type {
  MaintenanceActionDraft,
  MaintenanceActionPlan,
  MaintenanceDomainOperation,
  MaintenancePlan,
  MaintenancePlanRequest,
} from './types';
import {
  buildMaintenanceActionIdempotencyKey,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
} from './types';

/** Options for deterministic maintenance action planning. */
export interface MaintenancePlannerOptions {
  /**
   * Maximum low-risk actions that may be auto-applied in one plan.
   *
   * @default 3
   */
  maxAutoApplyActions?: number;
  /**
   * Planner version recorded in emitted plans.
   *
   * @default 'self-reflect-maintenance-planner-v1'
   */
  plannerVersion?: string;
}

const LOW_RISK_CONFIDENCE_THRESHOLD = 0.8;
const MEMORY_AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.85;
const SKILL_AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.9;

const createDedupeKey = (draft: MaintenanceActionDraft) => {
  if (draft.actionType === 'write_memory') {
    const content =
      draft.value && typeof draft.value === 'object' && 'content' in draft.value
        ? draft.value.content
        : undefined;

    return `memory:${typeof content === 'string' ? content : draft.rationale}`;
  }

  if (draft.target?.skillDocumentId) {
    return `skill:${draft.target.skillDocumentId}`;
  }

  if (draft.target?.skillName) {
    return `skill:${draft.target.skillName}`;
  }

  return `${draft.actionType}:${draft.rationale}`;
};

const getRecordField = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object') return undefined;

  return (value as Record<string, unknown>)[key];
};

const getStringField = (value: unknown, key: string) => {
  const field = getRecordField(value, key);

  return typeof field === 'string' && field.trim().length > 0 ? field.trim() : undefined;
};

const getStringArrayField = (value: unknown, key: string) => {
  const field = getRecordField(value, key);

  if (!Array.isArray(field)) return undefined;

  const strings = field.filter((item): item is string => typeof item === 'string');

  return strings.length === field.length && strings.length > 0 ? strings : undefined;
};

const getReadonlyField = (value: unknown) => {
  const field = getRecordField(value, 'targetReadonly') ?? getRecordField(value, 'readonly');

  return typeof field === 'boolean' ? field : undefined;
};

const getTargetReadonly = (draft: MaintenanceActionDraft) =>
  draft.target?.targetReadonly ?? getReadonlyField(draft.value);

const createOperation = (
  draft: MaintenanceActionDraft,
  request: MaintenancePlanRequest,
): MaintenanceDomainOperation | undefined => {
  if (draft.actionType === 'write_memory') {
    const content = getStringField(draft.value, 'content');

    if (!content) return undefined;

    return {
      domain: 'memory',
      input: { content, userId: request.userId },
      operation: 'write',
    };
  }

  if (draft.actionType === 'create_skill') {
    return {
      domain: 'skill',
      input: {
        bodyMarkdown:
          getStringField(draft.value, 'bodyMarkdown') ?? getStringField(draft.value, 'content'),
        description: getStringField(draft.value, 'description'),
        name: getStringField(draft.value, 'name'),
        targetReadonly: getTargetReadonly(draft),
        title: getStringField(draft.value, 'title'),
        userId: request.userId,
      },
      operation: 'create',
    };
  }

  if (draft.actionType === 'refine_skill') {
    const skillDocumentId =
      getStringField(draft.value, 'skillDocumentId') ?? draft.target?.skillDocumentId;

    if (!skillDocumentId) return undefined;

    return {
      domain: 'skill',
      input: {
        patch:
          getStringField(draft.value, 'patch') ??
          getStringField(draft.value, 'bodyMarkdown') ??
          getStringField(draft.value, 'content'),
        targetReadonly: getTargetReadonly(draft),
        skillDocumentId,
        userId: request.userId,
      },
      operation: 'refine',
    };
  }

  if (draft.actionType === 'consolidate_skill') {
    const canonicalSkillDocumentId =
      getStringField(draft.value, 'canonicalSkillDocumentId') ?? draft.target?.skillDocumentId;
    const sourceSkillIds = getStringArrayField(draft.value, 'sourceSkillIds');

    if (!canonicalSkillDocumentId || !sourceSkillIds) return undefined;

    return {
      domain: 'skill',
      input: {
        canonicalSkillDocumentId,
        targetReadonly: getTargetReadonly(draft),
        sourceSkillIds,
        userId: request.userId,
      },
      operation: 'consolidate',
    };
  }

  return undefined;
};

const isReadonlyDraftTarget = (draft: MaintenanceActionDraft) => Boolean(getTargetReadonly(draft));

const classifyMemoryPlan = (
  draft: MaintenanceActionDraft,
): Pick<MaintenanceActionPlan, 'applyMode' | 'risk'> => {
  if (draft.policyHints?.sensitivity === 'sensitive') {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.High };
  }

  const canAutoApply =
    draft.confidence >= MEMORY_AUTO_APPLY_CONFIDENCE_THRESHOLD &&
    draft.policyHints?.evidenceStrength === 'strong' &&
    draft.policyHints?.persistence === 'stable' &&
    draft.policyHints?.sensitivity === 'normal' &&
    draft.policyHints?.userExplicitness === 'explicit';

  if (!canAutoApply) {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.Medium };
  }

  return { applyMode: MaintenanceApplyMode.AutoApply, risk: MaintenanceRisk.Low };
};

const isStrongSmallSkillDraft = (draft: MaintenanceActionDraft) =>
  draft.confidence >= SKILL_AUTO_APPLY_CONFIDENCE_THRESHOLD &&
  draft.policyHints?.evidenceStrength === 'strong' &&
  draft.policyHints?.mutationScope === 'small';

const hasAutoApplySkillIntent = (draft: MaintenanceActionDraft) =>
  draft.policyHints?.userExplicitness === 'explicit' ||
  (draft.actionType === 'refine_skill' &&
    draft.policyHints?.userExplicitness === 'implicit' &&
    draft.evidenceRefs.length >= 2);

const classifySkillPlan = (
  draft: MaintenanceActionDraft,
  reviewScope: MaintenanceReviewScope,
): Pick<MaintenanceActionPlan, 'applyMode' | 'risk'> => {
  if (draft.actionType === 'consolidate_skill') {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.High };
  }

  if (isReadonlyDraftTarget(draft)) {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.High };
  }

  if (!isStrongSmallSkillDraft(draft) || !hasAutoApplySkillIntent(draft)) {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.Medium };
  }

  if (draft.actionType === 'refine_skill' && !draft.target?.skillDocumentId) {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.Medium };
  }

  if (
    draft.actionType === 'create_skill' &&
    reviewScope !== MaintenanceReviewScope.SelfIterationIntent
  ) {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.Medium };
  }

  return { applyMode: MaintenanceApplyMode.AutoApply, risk: MaintenanceRisk.Low };
};

const classifyInitialPlan = (
  draft: MaintenanceActionDraft,
  reviewScope: MaintenanceReviewScope,
): Pick<MaintenanceActionPlan, 'applyMode' | 'risk'> => {
  if (draft.evidenceRefs.length === 0 || draft.confidence < LOW_RISK_CONFIDENCE_THRESHOLD) {
    return { applyMode: MaintenanceApplyMode.Skip, risk: MaintenanceRisk.High };
  }

  if (draft.actionType === 'noop' || draft.actionType === 'proposal_only') {
    return { applyMode: MaintenanceApplyMode.ProposalOnly, risk: MaintenanceRisk.Medium };
  }

  if (draft.actionType === 'write_memory') {
    return classifyMemoryPlan(draft);
  }

  return classifySkillPlan(draft, reviewScope);
};

/**
 * Creates the deterministic self-reflection maintenance planner.
 *
 * Use when:
 * - Reviewer drafts need to become bounded executable action plans
 * - Source handlers need one policy boundary before executor mutation
 *
 * Expects:
 * - Reviewer output has already been parsed into `MaintenancePlanDraft`
 * - Domain services will perform final payload validation before writing
 *
 * Returns:
 * - A planner that emits `MaintenancePlan` without performing side effects
 */
export const createMaintenancePlannerService = (options: MaintenancePlannerOptions = {}) => {
  const maxAutoApplyActions = options.maxAutoApplyActions ?? 3;
  const plannerVersion = options.plannerVersion ?? 'self-reflect-maintenance-planner-v1';

  return {
    plan: (request: MaintenancePlanRequest): MaintenancePlan => {
      return tracer.startActiveSpan(
        'agent_signal.nightly_review.planner.plan',
        {
          attributes: {
            'agent.signal.nightly.draft_action_count': request.draft.actions.length,
            'agent.signal.nightly.finding_count': request.draft.findings.length,
            'agent.signal.nightly.max_auto_apply_actions': maxAutoApplyActions,
            'agent.signal.nightly.review_scope': request.reviewScope,
            'agent.signal.source_id': request.sourceId,
            'agent.signal.user_id': request.userId,
          },
        },
        (span) => {
          try {
            let autoApplyCount = 0;

            const actions = request.draft.actions.map((draft): MaintenanceActionPlan => {
              const dedupeKey = createDedupeKey(draft);
              const initialPlan = classifyInitialPlan(draft, request.reviewScope);
              const operation = createOperation(draft, request);
              const applyMode =
                initialPlan.applyMode === MaintenanceApplyMode.AutoApply &&
                (autoApplyCount >= maxAutoApplyActions || !operation)
                  ? MaintenanceApplyMode.ProposalOnly
                  : initialPlan.applyMode;

              if (applyMode === MaintenanceApplyMode.AutoApply) {
                autoApplyCount += 1;
              }

              return {
                actionType: draft.actionType,
                applyMode,
                confidence: draft.confidence,
                dedupeKey,
                evidenceRefs: draft.evidenceRefs,
                idempotencyKey: buildMaintenanceActionIdempotencyKey({
                  actionType: draft.actionType,
                  dedupeKey,
                  sourceId: request.sourceId,
                }),
                operation,
                rationale: draft.rationale,
                risk:
                  initialPlan.applyMode === MaintenanceApplyMode.AutoApply &&
                  applyMode === MaintenanceApplyMode.ProposalOnly
                    ? MaintenanceRisk.Medium
                    : initialPlan.risk,
                target: draft.target,
              };
            });
            const plan = {
              actions,
              localDate: request.localDate,
              plannerVersion,
              reviewScope: request.reviewScope,
              summary: request.draft.summary,
            };

            span.setAttribute('agent.signal.nightly.plan_action_count', actions.length);
            span.setAttribute('agent.signal.nightly.auto_apply_count', autoApplyCount);
            span.setAttribute(
              'agent.signal.nightly.proposal_count',
              actions.filter((action) => action.applyMode === MaintenanceApplyMode.ProposalOnly)
                .length,
            );
            span.setAttribute(
              'agent.signal.nightly.skip_count',
              actions.filter((action) => action.applyMode === MaintenanceApplyMode.Skip).length,
            );
            span.setStatus({ code: SpanStatusCode.OK });

            return plan;
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : 'AgentSignal nightly review planning failed',
            });
            span.recordException(error as Error);

            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };
};
