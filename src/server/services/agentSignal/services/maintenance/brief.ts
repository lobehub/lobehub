import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import type { BriefArtifactDocument, BriefMetadata } from '@lobechat/types';

import { BriefModel } from '@/database/models/brief';
import type { BriefItem, NewBrief } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type {
  MaintenanceProposalMetadata,
  MaintenanceProposalPlan,
  MaintenanceReviewIdea,
} from './proposal';
import {
  AGENT_SIGNAL_PROPOSAL_BRIEF_ACTIONS,
  buildMaintenanceProposalFromPlan,
  getMaintenanceProposalFromBriefMetadata,
  refreshMaintenanceProposal,
  shouldRefreshMaintenanceProposal,
  shouldSupersedeMaintenanceProposal,
  supersedeMaintenanceProposal,
} from './proposal';
import type { EvidenceRef, MaintenanceReviewRunResult } from './types';
import { MaintenanceActionStatus, ReviewRunStatus } from './types';

export const NIGHTLY_REVIEW_BRIEF_TRIGGER = 'agent-signal:nightly-review';

interface MaintenanceBriefActionCounts {
  /** Number of actions applied to durable resources. */
  applied: number;
  /** Number of actions that failed after planning or execution. */
  failed: number;
  /** Number of actions left as user-visible proposals. */
  proposed: number;
  /** Number of actions skipped by planner or executor policy. */
  skipped: number;
}

/** Metadata stored with Agent Signal maintenance Daily Briefs. */
export interface MaintenanceBriefMetadata {
  /** Per-action status counts used by UI filters and eval assertions. */
  actionCounts: MaintenanceBriefActionCounts;
  /** Evidence refs retained from reviewer/planner context for audit drilldown. */
  evidenceRefs: EvidenceRef[];
  /** Non-actionable self-review ideas retained without entering approve-time apply. */
  ideas?: MaintenanceReviewIdea[];
  /** User-local review date in YYYY-MM-DD form. */
  localDate: string;
  /** Frozen maintenance proposal state for approve/dismiss flows. */
  maintenanceProposal?: MaintenanceProposalMetadata;
  /** Coarse user-visible outcome selected by the projection service. */
  outcome: 'applied' | 'error' | 'ideas' | 'proposal';
  /** Durable receipt ids linked to this brief. */
  receiptIds: string[];
  /** Review source id that produced this brief. */
  sourceId?: string;
  /** IANA timezone used for the nightly review window. */
  timezone: string;
  /** Review window end ISO timestamp. */
  windowEnd: string;
  /** Review window start ISO timestamp. */
  windowStart: string;
}

/** Namespaced metadata payload stored by Agent Signal nightly self-review briefs. */
export interface AgentSignalNightlySelfReviewBriefMetadata extends BriefMetadata {
  /** Agent Signal-owned metadata namespace. */
  agentSignal: {
    /** Nightly self-review status, receipts, and optional frozen proposal. */
    nightlySelfReview: MaintenanceBriefMetadata;
    /** Future Agent Signal domains can live beside nightly self-review. */
    [key: string]: unknown;
  };
}

/** Create payload for a maintenance Daily Brief. */
export type MaintenanceBriefProjection = Omit<NewBrief, 'id' | 'userId'> & {
  metadata: AgentSignalNightlySelfReviewBriefMetadata;
  trigger: typeof NIGHTLY_REVIEW_BRIEF_TRIGGER;
};

const isProposalExpired = (proposal: Pick<MaintenanceProposalMetadata, 'expiresAt'>, now: string) =>
  new Date(proposal.expiresAt).getTime() <= new Date(now).getTime();

const updateBriefProposalMetadata = (
  brief: BriefItem,
  proposal: MaintenanceProposalMetadata,
): BriefItem['metadata'] => ({
  ...asMetadataRecord(brief.metadata),
  agentSignal: {
    ...asMetadataRecord(asMetadataRecord(brief.metadata).agentSignal),
    nightlySelfReview: {
      ...asMetadataRecord(
        asMetadataRecord(asMetadataRecord(brief.metadata).agentSignal).nightlySelfReview,
      ),
      maintenanceProposal: proposal,
    },
  },
});

const asMetadataRecord = (metadata: unknown): Record<string, unknown> =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

/** Reads Agent Signal nightly self-review metadata from a namespaced Brief payload. */
export const getNightlySelfReviewBriefMetadata = (
  metadata: unknown,
): MaintenanceBriefMetadata | undefined => {
  const agentSignal = asMetadataRecord(asMetadataRecord(metadata).agentSignal);
  const nightlySelfReview = agentSignal.nightlySelfReview;

  return nightlySelfReview &&
    typeof nightlySelfReview === 'object' &&
    !Array.isArray(nightlySelfReview)
    ? (nightlySelfReview as MaintenanceBriefMetadata)
    : undefined;
};

const createNightlySelfReviewBriefMetadata = ({
  actionCounts,
  evidenceRefs,
  input,
  outcome,
  proposal,
}: {
  actionCounts: MaintenanceBriefActionCounts;
  evidenceRefs: EvidenceRef[];
  input: ProjectNightlyReviewBriefInput;
  outcome: MaintenanceBriefMetadata['outcome'];
  proposal?: MaintenanceProposalMetadata;
}): AgentSignalNightlySelfReviewBriefMetadata => ({
  agentSignal: {
    nightlySelfReview: {
      actionCounts,
      evidenceRefs,
      ...(input.ideas?.length ? { ideas: input.ideas } : {}),
      localDate: input.localDate,
      outcome,
      ...(proposal ? { maintenanceProposal: proposal } : {}),
      receiptIds: getReceiptIds(input.result),
      ...(input.result.sourceId ? { sourceId: input.result.sourceId } : {}),
      timezone: input.timezone,
      windowEnd: input.reviewWindowEnd,
      windowStart: input.reviewWindowStart,
    },
  },
});

const ACTIVE_PROPOSAL_REFRESH_STATUSES = new Set<MaintenanceProposalMetadata['status']>([
  'expired',
  'pending',
  'stale',
]);

const findExistingProposalBrief = async ({
  agentId,
  incomingProposal,
  model,
  trigger,
}: {
  agentId: string;
  incomingProposal: MaintenanceProposalMetadata;
  model: BriefModel;
  trigger: typeof NIGHTLY_REVIEW_BRIEF_TRIGGER;
}) => {
  const rows = await model.listUnresolvedByAgentAndTrigger({
    agentId,
    limit: 20,
    trigger,
  });

  return rows.find((row) => {
    const proposal = getMaintenanceProposalFromBriefMetadata(row.metadata);

    return (
      proposal?.proposalKey === incomingProposal.proposalKey &&
      ACTIVE_PROPOSAL_REFRESH_STATUSES.has(proposal.status)
    );
  });
};

const updateProposalMetadata = async (
  model: BriefModel,
  brief: BriefItem,
  proposal: MaintenanceProposalMetadata,
) => model.updateMetadata(brief.id, updateBriefProposalMetadata(brief, proposal));

const refreshProposalBrief = ({
  fallbackBrief,
  model,
  proposal,
  targetBrief,
}: {
  fallbackBrief: MaintenanceBriefProjection;
  model: BriefModel;
  proposal: MaintenanceProposalMetadata;
  targetBrief: BriefItem;
}) =>
  tracer.startActiveSpan(
    'agent_signal.maintenance_proposal.refresh',
    {
      attributes: {
        'agent.signal.proposal.key': proposal.proposalKey,
        'agent.signal.proposal.status': proposal.status,
      },
    },
    async (span) => {
      try {
        const updatedBrief = await updateProposalMetadata(model, targetBrief, proposal);

        return updatedBrief ?? model.create(fallbackBrief);
      } finally {
        span.end();
      }
    },
  );

const supersedeProposalBrief = ({
  model,
  proposal,
  targetBrief,
}: {
  model: BriefModel;
  proposal: MaintenanceProposalMetadata;
  targetBrief: BriefItem;
}) =>
  tracer.startActiveSpan(
    'agent_signal.maintenance_proposal.supersede',
    {
      attributes: {
        'agent.signal.proposal.key': proposal.proposalKey,
        'agent.signal.proposal.status': proposal.status,
      },
    },
    async (span) => {
      try {
        await updateProposalMetadata(model, targetBrief, proposal);
      } finally {
        span.end();
      }
    },
  );

/** Input used to project one nightly maintenance result to a Daily Brief payload. */
export interface ProjectNightlyReviewBriefInput {
  /** Agent reviewed by the nightly maintenance run. */
  agentId: string;
  /** Evidence refs retained from the review or source handler. */
  evidenceRefs?: EvidenceRef[];
  /** Non-actionable self-review ideas collected during the run. */
  ideas?: MaintenanceReviewIdea[];
  /** User-local date reviewed by the nightly run. */
  localDate: string;
  /** Frozen maintenance plan used to preserve proposal actions. */
  plan?: MaintenanceProposalPlan;
  /** Executor result for the nightly maintenance run. */
  result: MaintenanceReviewRunResult;
  /** Review window end ISO timestamp. */
  reviewWindowEnd: string;
  /** Review window start ISO timestamp. */
  reviewWindowStart: string;
  /** IANA timezone used for nightly scheduling. */
  timezone: string;
  /** User that owns the agent and brief. */
  userId: string;
}

/** Gate checks required before applying a pending maintenance proposal. */
export interface CanApplyMaintenanceProposalInput {
  /** Checks whether the target agent still allows self-iteration mutations. */
  checkAgentGate: () => boolean | Promise<boolean>;
  /** Checks whether server-side feature gates still allow proposal application. */
  checkServerGate: () => boolean | Promise<boolean>;
  /** Checks whether the current user still enables self-iteration. */
  checkUserGate: () => boolean | Promise<boolean>;
}

/** Result of proposal apply gate re-checks. */
export interface MaintenanceProposalApplyGateResult {
  /** Whether the caller may apply the proposal mutation. */
  allowed: boolean;
  /** Machine-readable blocked reason when `allowed` is false. */
  reason?: 'agent_gate_disabled' | 'server_gate_disabled' | 'user_gate_disabled';
}

/** Input used to decide whether an existing maintenance proposal stays visible. */
export interface MaintenanceProposalVisibilityInput {
  /** Current self-iteration setting. Does not hide already-created proposals. */
  selfIterationEnabled: boolean;
  /** Proposal resolution state. */
  status: 'dismissed' | 'pending' | 'resolved';
  /** Brief trigger namespace. */
  trigger?: string | null;
}

const getPlanActionByIdempotencyKey = (plan?: MaintenanceProposalPlan) =>
  new Map(plan?.actions.map((action) => [action.idempotencyKey, action]));

const isVisibleProposalResult = (
  action: MaintenanceReviewRunResult['actions'][number],
  planActionByIdempotencyKey: Map<
    string,
    MaintenanceProposalPlan['actions'][number]
  > = getPlanActionByIdempotencyKey(),
) => {
  if (action.status !== MaintenanceActionStatus.Proposed || !action.receiptId) return false;

  const plannedAction = planActionByIdempotencyKey.get(action.idempotencyKey);

  return plannedAction?.actionType !== 'noop';
};

const countActions = (
  result: MaintenanceReviewRunResult,
  plan?: MaintenanceProposalPlan,
): MaintenanceBriefActionCounts => {
  const counts: MaintenanceBriefActionCounts = {
    applied: 0,
    failed: 0,
    proposed: 0,
    skipped: 0,
  };
  const planActionByIdempotencyKey = getPlanActionByIdempotencyKey(plan);

  for (const action of result.actions) {
    if (action.status === MaintenanceActionStatus.Applied) counts.applied += 1;
    if (action.status === MaintenanceActionStatus.Failed) counts.failed += 1;
    if (isVisibleProposalResult(action, planActionByIdempotencyKey)) counts.proposed += 1;
    if (
      action.status === MaintenanceActionStatus.Skipped ||
      action.status === MaintenanceActionStatus.Deduped
    ) {
      counts.skipped += 1;
    }
  }

  return counts;
};

const getReceiptIds = (result: MaintenanceReviewRunResult) => [
  ...(result.summaryReceiptId ? [result.summaryReceiptId] : []),
  ...result.actions.flatMap((action) => (action.receiptId ? [action.receiptId] : [])),
];

const getOutcome = (
  result: MaintenanceReviewRunResult,
  counts: MaintenanceBriefActionCounts,
  ideas: MaintenanceReviewIdea[] = [],
): MaintenanceBriefMetadata['outcome'] | undefined => {
  if (counts.proposed > 0) return 'proposal';
  if (counts.applied > 0) return 'applied';
  if (counts.failed > 0 || result.status === ReviewRunStatus.Failed) return 'error';
  if (ideas.length > 0) return 'ideas';

  return;
};

const formatActionSummaries = (
  result: MaintenanceReviewRunResult,
  status: MaintenanceActionStatus,
  heading: string,
  plan?: MaintenanceProposalPlan,
) => {
  const planActionByIdempotencyKey = getPlanActionByIdempotencyKey(plan);
  const summaries = result.actions
    .filter((action) => {
      if (status !== MaintenanceActionStatus.Proposed) return action.status === status;

      return isVisibleProposalResult(action, planActionByIdempotencyKey);
    })
    .map((action) => action.summary?.trim() ?? '')
    .filter(Boolean);

  if (summaries.length === 0) return;

  return [`**${heading}**`, ...summaries.map((summary) => `- ${summary}`)].join('\n');
};

const createDetailedSummary = (
  summary: string,
  result: MaintenanceReviewRunResult,
  status: MaintenanceActionStatus,
  heading: string,
  plan?: MaintenanceProposalPlan,
) => {
  const details = formatActionSummaries(result, status, heading, plan);

  return details ? `${summary}\n\n${details}` : summary;
};

const collectBriefArtifactDocuments = ({
  ideas = [],
  proposal,
}: {
  ideas?: MaintenanceReviewIdea[];
  proposal?: MaintenanceProposalMetadata;
}): BriefArtifactDocument[] => {
  const documents = new Map<string, BriefArtifactDocument>();

  for (const action of proposal?.actions ?? []) {
    const id = action.target?.skillDocumentId ?? action.baseSnapshot?.agentDocumentId;
    if (!id) continue;

    documents.set(id, {
      id,
      kind: 'skill',
      title: action.baseSnapshot?.targetTitle ?? action.target?.skillName ?? action.rationale,
    });
  }

  for (const idea of ideas) {
    const id = idea.target?.skillDocumentId;
    if (!id) continue;

    documents.set(id, {
      id,
      kind: 'skill',
      title: idea.title ?? idea.target?.skillName ?? idea.rationale,
    });
  }

  return [...documents.values()];
};

const createBriefArtifacts = (input: {
  ideas?: MaintenanceReviewIdea[];
  proposal?: MaintenanceProposalMetadata;
}) => {
  const documents = collectBriefArtifactDocuments(input);

  return documents.length > 0 ? { documents } : undefined;
};

const createBriefCopy = (
  outcome: MaintenanceBriefMetadata['outcome'],
  counts: MaintenanceBriefActionCounts,
  result: MaintenanceReviewRunResult,
  plan?: MaintenanceProposalPlan,
) => {
  if (outcome === 'proposal') {
    const summary = `${counts.proposed} maintenance proposal${counts.proposed === 1 ? '' : 's'} need review.`;

    return {
      priority: 'normal' as const,
      summary: createDetailedSummary(
        summary,
        result,
        MaintenanceActionStatus.Proposed,
        'Proposal',
        plan,
      ),
      title: 'Agent self-review proposal',
      type: 'decision' as const,
    };
  }

  if (outcome === 'error') {
    const summary = 'Agent self-review could not finish all maintenance actions.';

    return {
      priority: 'normal' as const,
      summary: createDetailedSummary(summary, result, MaintenanceActionStatus.Failed, 'Failure'),
      title: 'Agent self-review needs attention',
      type: 'error' as const,
    };
  }

  if (outcome === 'ideas') {
    return {
      priority: 'info' as const,
      summary: 'Agent self-review saved maintenance ideas for future review.',
      title: 'Agent self-review ideas',
      type: 'insight' as const,
    };
  }

  const summary = `${counts.applied} maintenance update${counts.applied === 1 ? '' : 's'} applied.`;

  return {
    priority: 'info' as const,
    summary: createDetailedSummary(summary, result, MaintenanceActionStatus.Applied, 'Updated'),
    title: 'Agent self-review updated resources',
    type: 'insight' as const,
  };
};

/**
 * Creates projection helpers for Agent Signal maintenance Daily Briefs.
 *
 * Use when:
 * - Nightly review handlers need to create user-visible brief payloads
 * - Proposal apply paths need to re-check current gates before mutation
 *
 * Expects:
 * - Maintenance execution has already finished and receipts have been attempted first
 * - Callers persist the returned brief payload through `BriefModel.create`
 *
 * Returns:
 * - Pure projection helpers with no database writes
 */
export const createBriefMaintenanceService = () => ({
  /**
   * Checks whether a pending maintenance proposal can be applied right now.
   *
   * Use when:
   * - A user approves a previously-created maintenance proposal
   * - Current feature/user/agent gates must be honored at apply time
   *
   * Expects:
   * - Gate checks are side-effect free and return current server truth
   *
   * Returns:
   * - `allowed: true` only when every gate passes
   */
  canApplyMaintenanceProposal: async (
    input: CanApplyMaintenanceProposalInput,
  ): Promise<MaintenanceProposalApplyGateResult> => {
    if (!(await input.checkServerGate())) return { allowed: false, reason: 'server_gate_disabled' };
    if (!(await input.checkUserGate())) return { allowed: false, reason: 'user_gate_disabled' };
    if (!(await input.checkAgentGate())) return { allowed: false, reason: 'agent_gate_disabled' };

    return { allowed: true };
  },

  /**
   * Keeps already-created proposal briefs visible independently from current gates.
   *
   * Use when:
   * - Daily Brief lists decide whether to show pending Agent Signal proposals
   * - Self-iteration has been disabled after proposal creation
   *
   * Expects:
   * - The caller separately blocks proposal application with `canApplyMaintenanceProposal`
   *
   * Returns:
   * - `true` for pending Agent Signal nightly proposals
   */
  isMaintenanceProposalVisible: (input: MaintenanceProposalVisibilityInput) =>
    input.trigger === NIGHTLY_REVIEW_BRIEF_TRIGGER && input.status === 'pending',

  /**
   * Projects one nightly review execution result into a Daily Brief create payload.
   *
   * Use when:
   * - Nightly review handlers have already executed maintenance actions
   * - Noop reviews should remain silent while applied/proposal/error outcomes surface
   *
   * Expects:
   * - `result.actions` contains executor-order action results
   * - `reviewWindowStart` and `reviewWindowEnd` are ISO strings from the scheduler
   *
   * Returns:
   * - A Daily Brief create payload, or `undefined` for pure noop outcomes
   */
  projectNightlyReviewBrief: (
    input: ProjectNightlyReviewBriefInput,
  ): MaintenanceBriefProjection | undefined => {
    const actionCounts = countActions(input.result, input.plan);
    const outcome = getOutcome(input.result, actionCounts, input.ideas);

    if (!outcome) return;

    const copy = createBriefCopy(outcome, actionCounts, input.result, input.plan);
    const proposal =
      outcome === 'proposal' && input.plan
        ? buildMaintenanceProposalFromPlan({
            agentId: input.agentId,
            evidenceWindowEnd: input.reviewWindowEnd,
            evidenceWindowStart: input.reviewWindowStart,
            now: input.reviewWindowEnd,
            plan: input.plan,
            results: input.result.actions,
          })
        : undefined;
    const artifacts = createBriefArtifacts({ ideas: input.ideas, proposal });

    return {
      ...(proposal ? { actions: AGENT_SIGNAL_PROPOSAL_BRIEF_ACTIONS } : {}),
      agentId: input.agentId,
      ...(artifacts ? { artifacts } : {}),
      metadata: createNightlySelfReviewBriefMetadata({
        actionCounts,
        evidenceRefs: input.evidenceRefs ?? [],
        input,
        outcome,
        proposal,
      }),
      priority: copy.priority,
      summary: copy.summary,
      title: copy.title,
      trigger: NIGHTLY_REVIEW_BRIEF_TRIGGER,
      type: copy.type,
    };
  },
});

/**
 * Creates the server Daily Brief writer backed by {@link BriefModel}.
 *
 * Use when:
 * - Agent Signal nightly review policy options are installed in the server runtime
 * - Eligible nightly outcomes must become real Daily Brief rows
 *
 * Expects:
 * - `db` and `userId` belong to the source-event owner
 *
 * Returns:
 * - A writer whose `writeDailyBrief` method creates or refreshes proposal briefs
 */
export const createServerMaintenanceBriefWriter = (db: LobeChatDatabase, userId: string) => {
  const model = new BriefModel(db, userId);

  return {
    writeDailyBrief: (brief: MaintenanceBriefProjection) => {
      const incomingProposal = brief.metadata.agentSignal.nightlySelfReview.maintenanceProposal;

      return tracer.startActiveSpan(
        'agent_signal.maintenance_brief.write',
        {
          attributes: {
            'agent.signal.agent_id': brief.agentId ?? '',
            'agent.signal.brief.trigger': brief.trigger,
            'agent.signal.user_id': userId,
            ...(incomingProposal
              ? {
                  'agent.signal.proposal.action_count': incomingProposal.actions.length,
                  'agent.signal.proposal.key': incomingProposal.proposalKey,
                }
              : {}),
          },
        },
        async (span) => {
          try {
            if (!incomingProposal || !brief.agentId) return model.create(brief);

            const now = incomingProposal.updatedAt;
            const existingBrief = await findExistingProposalBrief({
              agentId: brief.agentId,
              incomingProposal,
              model,
              trigger: brief.trigger,
            });

            if (!existingBrief) return model.create(brief);

            const existingProposal = getMaintenanceProposalFromBriefMetadata(
              existingBrief.metadata,
            );
            if (!existingProposal) return model.create(brief);

            if (existingProposal.status === 'pending' && isProposalExpired(existingProposal, now)) {
              const expiredProposal: MaintenanceProposalMetadata = {
                ...existingProposal,
                status: 'expired',
                updatedAt: now,
              };
              await updateProposalMetadata(model, existingBrief, expiredProposal);
              span.setAttribute('agent.signal.proposal.status', 'expired');

              return model.create(brief);
            }

            const refresh = shouldRefreshMaintenanceProposal({
              existing: existingProposal,
              incoming: incomingProposal,
              now,
            });
            if (
              refresh.refresh &&
              shouldSupersedeMaintenanceProposal({
                existing: existingProposal,
                incoming: incomingProposal,
                now,
              }).supersede === false
            ) {
              const refreshedProposal = refreshMaintenanceProposal({
                existing: existingProposal,
                incoming: incomingProposal,
                now,
              });
              span.setAttribute('agent.signal.proposal.status', 'refreshed');

              return refreshProposalBrief({
                fallbackBrief: brief,
                model,
                proposal: refreshedProposal,
                targetBrief: existingBrief,
              });
            }

            const supersede = shouldSupersedeMaintenanceProposal({
              existing: existingProposal,
              incoming: incomingProposal,
              now,
            });
            if (supersede.supersede) {
              const supersededProposal = supersedeMaintenanceProposal({
                existing: existingProposal,
                now,
                supersededBy: incomingProposal.proposalKey,
              });
              await supersedeProposalBrief({
                model,
                proposal: supersededProposal,
                targetBrief: existingBrief,
              });
              span.setAttribute('agent.signal.proposal.status', 'superseded');

              return model.create(brief);
            }

            return model.create(brief);
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };
};
