import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import type { BriefArtifactDocument, BriefMetadata } from '@lobechat/types';

import { BriefModel } from '@/database/models/brief';
import type { BriefItem, NewBrief } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { EvidenceRef, RunResult } from '../types';
import { ActionStatus, ReviewRunStatus } from '../types';
import type {
  SelfReviewIdea,
  SelfReviewProposalMetadata,
  SelfReviewProposalPlan,
} from './proposal';
import {
  AGENT_SIGNAL_PROPOSAL_BRIEF_ACTIONS,
  buildSelfReviewProposalFromPlan,
  getSelfReviewProposalFromBriefMetadata,
  refreshSelfReviewProposal,
  shouldRefreshSelfReviewProposal,
  shouldSupersedeSelfReviewProposal,
  supersedeSelfReviewProposal,
} from './proposal';

export const NIGHTLY_REVIEW_BRIEF_TRIGGER = 'agent-signal:nightly-review';

interface SelfReviewBriefActionCounts {
  /** Number of actions applied to durable resources. */
  applied: number;
  /** Number of actions that failed after planning or execution. */
  failed: number;
  /** Number of actions left as user-visible proposals. */
  proposed: number;
  /** Number of actions skipped by planner or executor policy. */
  skipped: number;
}

/** Metadata stored with Agent Signal self-review Daily Briefs. */
export interface SelfReviewBriefMetadata {
  /** Per-action status counts used by UI filters and eval assertions. */
  actionCounts: SelfReviewBriefActionCounts;
  /** Evidence refs retained from reviewer/planner context for audit drilldown. */
  evidenceRefs: EvidenceRef[];
  /** Non-actionable self-review ideas retained without entering approve-time apply. */
  ideas?: SelfReviewIdea[];
  /** User-local review date in YYYY-MM-DD form. */
  localDate: string;
  /** Coarse user-visible outcome selected by the projection service. */
  outcome: 'applied' | 'error' | 'ideas' | 'proposal';
  /** Durable receipt ids linked to this brief. */
  receiptIds: string[];
  /** Frozen self-review proposal state for approve/dismiss flows. */
  selfReviewProposal?: SelfReviewProposalMetadata;
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
    nightlySelfReview: SelfReviewBriefMetadata;
    /** Future Agent Signal domains can live beside nightly self-review. */
    [key: string]: unknown;
  };
}

/** Create payload for a self-review Daily Brief. */
export type SelfReviewBriefProjection = Omit<NewBrief, 'id' | 'userId'> & {
  metadata: AgentSignalNightlySelfReviewBriefMetadata;
  trigger: typeof NIGHTLY_REVIEW_BRIEF_TRIGGER;
};

const isProposalExpired = (proposal: Pick<SelfReviewProposalMetadata, 'expiresAt'>, now: string) =>
  new Date(proposal.expiresAt).getTime() <= new Date(now).getTime();

const updateBriefProposalMetadata = (
  brief: BriefItem,
  proposal: SelfReviewProposalMetadata,
): BriefItem['metadata'] => ({
  ...asMetadataRecord(brief.metadata),
  agentSignal: {
    ...asMetadataRecord(asMetadataRecord(brief.metadata).agentSignal),
    nightlySelfReview: {
      ...asMetadataRecord(
        asMetadataRecord(asMetadataRecord(brief.metadata).agentSignal).nightlySelfReview,
      ),
      selfReviewProposal: proposal,
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
): SelfReviewBriefMetadata | undefined => {
  const agentSignal = asMetadataRecord(asMetadataRecord(metadata).agentSignal);
  const nightlySelfReview = agentSignal.nightlySelfReview;

  return nightlySelfReview &&
    typeof nightlySelfReview === 'object' &&
    !Array.isArray(nightlySelfReview)
    ? (nightlySelfReview as SelfReviewBriefMetadata)
    : undefined;
};

const createNightlySelfReviewBriefMetadata = ({
  actionCounts,
  evidenceRefs,
  input,
  outcome,
  proposal,
}: {
  actionCounts: SelfReviewBriefActionCounts;
  evidenceRefs: EvidenceRef[];
  input: ProjectNightlyReviewBriefInput;
  outcome: SelfReviewBriefMetadata['outcome'];
  proposal?: SelfReviewProposalMetadata;
}): AgentSignalNightlySelfReviewBriefMetadata => ({
  agentSignal: {
    nightlySelfReview: {
      actionCounts,
      evidenceRefs,
      ...(input.ideas?.length ? { ideas: input.ideas } : {}),
      localDate: input.localDate,
      outcome,
      ...(proposal ? { selfReviewProposal: proposal } : {}),
      receiptIds: getReceiptIds(input.result),
      ...(input.result.sourceId ? { sourceId: input.result.sourceId } : {}),
      timezone: input.timezone,
      windowEnd: input.reviewWindowEnd,
      windowStart: input.reviewWindowStart,
    },
  },
});

const ACTIVE_PROPOSAL_REFRESH_STATUSES = new Set<SelfReviewProposalMetadata['status']>([
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
  incomingProposal: SelfReviewProposalMetadata;
  model: BriefModel;
  trigger: typeof NIGHTLY_REVIEW_BRIEF_TRIGGER;
}) => {
  const rows = await model.listUnresolvedByAgentAndTrigger({
    agentId,
    limit: 20,
    trigger,
  });

  return rows.find((row) => {
    const proposal = getSelfReviewProposalFromBriefMetadata(row.metadata);

    return (
      proposal?.proposalKey === incomingProposal.proposalKey &&
      ACTIVE_PROPOSAL_REFRESH_STATUSES.has(proposal.status)
    );
  });
};

const updateProposalMetadata = async (
  model: BriefModel,
  brief: BriefItem,
  proposal: SelfReviewProposalMetadata,
) => model.updateMetadata(brief.id, updateBriefProposalMetadata(brief, proposal));

const refreshProposalBrief = ({
  fallbackBrief,
  model,
  proposal,
  targetBrief,
}: {
  fallbackBrief: SelfReviewBriefProjection;
  model: BriefModel;
  proposal: SelfReviewProposalMetadata;
  targetBrief: BriefItem;
}) =>
  tracer.startActiveSpan(
    'agent_signal.self_review_proposal.refresh',
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
  proposal: SelfReviewProposalMetadata;
  targetBrief: BriefItem;
}) =>
  tracer.startActiveSpan(
    'agent_signal.self_review_proposal.supersede',
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

/** Input used to project one nightly shared result to a Daily Brief payload. */
export interface ProjectNightlyReviewBriefInput {
  /** Agent reviewed by the nightly shared run. */
  agentId: string;
  /** Evidence refs retained from the review or source handler. */
  evidenceRefs?: EvidenceRef[];
  /** Non-actionable self-review ideas collected during the run. */
  ideas?: SelfReviewIdea[];
  /** User-local date reviewed by the nightly run. */
  localDate: string;
  /** Frozen self-iteration plan used to preserve proposal actions. */
  plan?: SelfReviewProposalPlan;
  /** Executor result for the nightly shared run. */
  result: RunResult;
  /** Review window end ISO timestamp. */
  reviewWindowEnd: string;
  /** Review window start ISO timestamp. */
  reviewWindowStart: string;
  /** IANA timezone used for nightly scheduling. */
  timezone: string;
  /** User that owns the agent and brief. */
  userId: string;
}

/** Gate checks required before applying a pending self-review proposal. */
export interface CanApplySelfReviewProposalInput {
  /** Checks whether the target agent still allows self-iteration mutations. */
  checkAgentGate: () => boolean | Promise<boolean>;
  /** Checks whether server-side feature gates still allow proposal application. */
  checkServerGate: () => boolean | Promise<boolean>;
  /** Checks whether the current user still enables shared. */
  checkUserGate: () => boolean | Promise<boolean>;
}

/** Result of proposal apply gate re-checks. */
export interface SelfReviewProposalApplyGateResult {
  /** Whether the caller may apply the proposal mutation. */
  allowed: boolean;
  /** Machine-readable blocked reason when `allowed` is false. */
  reason?: 'agent_gate_disabled' | 'server_gate_disabled' | 'user_gate_disabled';
}

/** Input used to decide whether an existing self-review proposal stays visible. */
export interface SelfReviewProposalVisibilityInput {
  /** Current shared setting. Does not hide already-created proposals. */
  selfIterationEnabled: boolean;
  /** Proposal resolution state. */
  status: 'dismissed' | 'pending' | 'resolved';
  /** Brief trigger namespace. */
  trigger?: string | null;
}

const getPlanActionByIdempotencyKey = (plan?: SelfReviewProposalPlan) =>
  new Map(plan?.actions.map((action) => [action.idempotencyKey, action]));

const isVisibleProposalResult = (
  action: RunResult['actions'][number],
  planActionByIdempotencyKey: Map<
    string,
    SelfReviewProposalPlan['actions'][number]
  > = getPlanActionByIdempotencyKey(),
) => {
  if (action.status !== ActionStatus.Proposed || !action.receiptId) return false;

  const plannedAction = planActionByIdempotencyKey.get(action.idempotencyKey);

  return plannedAction?.actionType !== 'noop';
};

const countActions = (
  result: RunResult,
  plan?: SelfReviewProposalPlan,
): SelfReviewBriefActionCounts => {
  const counts: SelfReviewBriefActionCounts = {
    applied: 0,
    failed: 0,
    proposed: 0,
    skipped: 0,
  };
  const planActionByIdempotencyKey = getPlanActionByIdempotencyKey(plan);

  for (const action of result.actions) {
    if (action.status === ActionStatus.Applied) counts.applied += 1;
    if (action.status === ActionStatus.Failed) counts.failed += 1;
    if (isVisibleProposalResult(action, planActionByIdempotencyKey)) counts.proposed += 1;
    if (action.status === ActionStatus.Skipped || action.status === ActionStatus.Deduped) {
      counts.skipped += 1;
    }
  }

  return counts;
};

const getReceiptIds = (result: RunResult) => [
  ...(result.summaryReceiptId ? [result.summaryReceiptId] : []),
  ...result.actions.flatMap((action) => (action.receiptId ? [action.receiptId] : [])),
];

const getOutcome = (
  result: RunResult,
  counts: SelfReviewBriefActionCounts,
  ideas: SelfReviewIdea[] = [],
): SelfReviewBriefMetadata['outcome'] | undefined => {
  if (counts.proposed > 0) return 'proposal';
  if (counts.applied > 0) return 'applied';
  if (counts.failed > 0 || result.status === ReviewRunStatus.Failed) return 'error';
  if (ideas.length > 0) return 'ideas';

  return;
};

const formatActionSummaries = (
  result: RunResult,
  status: ActionStatus,
  heading: string,
  plan?: SelfReviewProposalPlan,
) => {
  const planActionByIdempotencyKey = getPlanActionByIdempotencyKey(plan);
  const summaries = result.actions
    .filter((action) => {
      if (status !== ActionStatus.Proposed) return action.status === status;

      return isVisibleProposalResult(action, planActionByIdempotencyKey);
    })
    .map((action) => action.summary?.trim() ?? '')
    .filter(Boolean);

  if (summaries.length === 0) return;

  return [`**${heading}**`, ...summaries.map((summary) => `- ${summary}`)].join('\n');
};

const createDetailedSummary = (
  summary: string,
  result: RunResult,
  status: ActionStatus,
  heading: string,
  plan?: SelfReviewProposalPlan,
) => {
  const details = formatActionSummaries(result, status, heading, plan);

  return details ? `${summary}\n\n${details}` : summary;
};

const collectBriefArtifactDocuments = ({
  ideas = [],
  proposal,
}: {
  ideas?: SelfReviewIdea[];
  proposal?: SelfReviewProposalMetadata;
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
  ideas?: SelfReviewIdea[];
  proposal?: SelfReviewProposalMetadata;
}) => {
  const documents = collectBriefArtifactDocuments(input);

  return documents.length > 0 ? { documents } : undefined;
};

const createBriefCopy = (
  outcome: SelfReviewBriefMetadata['outcome'],
  counts: SelfReviewBriefActionCounts,
  result: RunResult,
  plan?: SelfReviewProposalPlan,
) => {
  if (outcome === 'proposal') {
    const summary = `${counts.proposed} self-review proposal${counts.proposed === 1 ? '' : 's'} need review.`;

    return {
      priority: 'normal' as const,
      summary: createDetailedSummary(summary, result, ActionStatus.Proposed, 'Proposal', plan),
      title: 'Agent self-review proposal',
      type: 'decision' as const,
    };
  }

  if (outcome === 'error') {
    const summary = 'Agent self-review could not finish all self-review actions.';

    return {
      priority: 'normal' as const,
      summary: createDetailedSummary(summary, result, ActionStatus.Failed, 'Failure'),
      title: 'Agent self-review needs attention',
      type: 'error' as const,
    };
  }

  if (outcome === 'ideas') {
    return {
      priority: 'info' as const,
      summary: 'Agent self-review saved shared ideas for future review.',
      title: 'Agent self-review ideas',
      type: 'insight' as const,
    };
  }

  const summary = `${counts.applied} self-iteration update${counts.applied === 1 ? '' : 's'} applied.`;

  return {
    priority: 'info' as const,
    summary: createDetailedSummary(summary, result, ActionStatus.Applied, 'Updated'),
    title: 'Agent self-review updated resources',
    type: 'insight' as const,
  };
};

/**
 * Creates projection helpers for Agent Signal self-review Daily Briefs.
 *
 * Use when:
 * - Nightly review handlers need to create user-visible brief payloads
 * - Proposal apply paths need to re-check current gates before mutation
 *
 * Expects:
 * - SelfIteration execution has already finished and receipts have been attempted first
 * - Callers persist the returned brief payload through `BriefModel.create`
 *
 * Returns:
 * - Pure projection helpers with no database writes
 */
export const createBriefSelfReviewService = () => ({
  /**
   * Checks whether a pending self-review proposal can be applied right now.
   *
   * Use when:
   * - A user approves a previously-created self-review proposal
   * - Current feature/user/agent gates must be honored at apply time
   *
   * Expects:
   * - Gate checks are side-effect free and return current server truth
   *
   * Returns:
   * - `allowed: true` only when every gate passes
   */
  canApplySelfReviewProposal: async (
    input: CanApplySelfReviewProposalInput,
  ): Promise<SelfReviewProposalApplyGateResult> => {
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
   * - The caller separately blocks proposal application with `canApplySelfReviewProposal`
   *
   * Returns:
   * - `true` for pending Agent Signal nightly proposals
   */
  isSelfReviewProposalVisible: (input: SelfReviewProposalVisibilityInput) =>
    input.trigger === NIGHTLY_REVIEW_BRIEF_TRIGGER && input.status === 'pending',

  /**
   * Projects one nightly review execution result into a Daily Brief create payload.
   *
   * Use when:
   * - Nightly review handlers have already executed self-review actions
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
  ): SelfReviewBriefProjection | undefined => {
    const actionCounts = countActions(input.result, input.plan);
    const outcome = getOutcome(input.result, actionCounts, input.ideas);

    if (!outcome) return;

    const copy = createBriefCopy(outcome, actionCounts, input.result, input.plan);
    const proposal =
      outcome === 'proposal' && input.plan
        ? buildSelfReviewProposalFromPlan({
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
export const createServerSelfReviewBriefWriter = (db: LobeChatDatabase, userId: string) => {
  const model = new BriefModel(db, userId);

  return {
    writeDailyBrief: (brief: SelfReviewBriefProjection) => {
      const incomingProposal = brief.metadata.agentSignal.nightlySelfReview.selfReviewProposal;

      return tracer.startActiveSpan(
        'agent_signal.self_iteration_brief.write',
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

            const existingProposal = getSelfReviewProposalFromBriefMetadata(existingBrief.metadata);
            if (!existingProposal) return model.create(brief);

            if (existingProposal.status === 'pending' && isProposalExpired(existingProposal, now)) {
              const expiredProposal: SelfReviewProposalMetadata = {
                ...existingProposal,
                status: 'expired',
                updatedAt: now,
              };
              await updateProposalMetadata(model, existingBrief, expiredProposal);
              span.setAttribute('agent.signal.proposal.status', 'expired');

              return model.create(brief);
            }

            const refresh = shouldRefreshSelfReviewProposal({
              existing: existingProposal,
              incoming: incomingProposal,
              now,
            });
            if (
              refresh.refresh &&
              shouldSupersedeSelfReviewProposal({
                existing: existingProposal,
                incoming: incomingProposal,
                now,
              }).supersede === false
            ) {
              const refreshedProposal = refreshSelfReviewProposal({
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

            const supersede = shouldSupersedeSelfReviewProposal({
              existing: existingProposal,
              incoming: incomingProposal,
              now,
            });
            if (supersede.supersede) {
              const supersededProposal = supersedeSelfReviewProposal({
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
