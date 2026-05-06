import { BriefModel } from '@/database/models/brief';
import type { NewBrief } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { EvidenceRef, MaintenanceReviewRunResult } from './types';
import { MaintenanceActionStatus, ReviewRunStatus } from './types';

const NIGHTLY_REVIEW_BRIEF_TRIGGER = 'agent-signal:nightly-review';

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
  /** User-local review date in YYYY-MM-DD form. */
  localDate: string;
  /** Coarse user-visible outcome selected by the projection service. */
  outcome: 'applied' | 'error' | 'proposal';
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

/** Create payload for a maintenance Daily Brief. */
export type MaintenanceBriefProjection = Omit<NewBrief, 'id' | 'userId'> & {
  metadata: MaintenanceBriefMetadata;
  trigger: typeof NIGHTLY_REVIEW_BRIEF_TRIGGER;
};

/** Input used to project one nightly maintenance result to a Daily Brief payload. */
export interface ProjectNightlyReviewBriefInput {
  /** Agent reviewed by the nightly maintenance run. */
  agentId: string;
  /** Evidence refs retained from the review or source handler. */
  evidenceRefs?: EvidenceRef[];
  /** User-local date reviewed by the nightly run. */
  localDate: string;
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

const countActions = (result: MaintenanceReviewRunResult): MaintenanceBriefActionCounts => {
  const counts: MaintenanceBriefActionCounts = {
    applied: 0,
    failed: 0,
    proposed: 0,
    skipped: 0,
  };

  for (const action of result.actions) {
    if (action.status === MaintenanceActionStatus.Applied) counts.applied += 1;
    if (action.status === MaintenanceActionStatus.Failed) counts.failed += 1;
    if (action.status === MaintenanceActionStatus.Proposed && action.receiptId) {
      counts.proposed += 1;
    }
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
): MaintenanceBriefMetadata['outcome'] | undefined => {
  if (counts.proposed > 0) return 'proposal';
  if (counts.applied > 0) return 'applied';
  if (counts.failed > 0 || result.status === ReviewRunStatus.Failed) return 'error';

  return;
};

const createBriefCopy = (
  outcome: MaintenanceBriefMetadata['outcome'],
  counts: MaintenanceBriefActionCounts,
) => {
  if (outcome === 'proposal') {
    return {
      priority: 'normal' as const,
      summary: `${counts.proposed} maintenance proposal${counts.proposed === 1 ? '' : 's'} need review.`,
      title: 'Agent self-review proposal',
      type: 'decision' as const,
    };
  }

  if (outcome === 'error') {
    return {
      priority: 'normal' as const,
      summary: 'Agent self-review could not finish all maintenance actions.',
      title: 'Agent self-review needs attention',
      type: 'error' as const,
    };
  }

  return {
    priority: 'info' as const,
    summary: `${counts.applied} maintenance update${counts.applied === 1 ? '' : 's'} applied.`,
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
    const actionCounts = countActions(input.result);
    const outcome = getOutcome(input.result, actionCounts);

    if (!outcome) return;

    const copy = createBriefCopy(outcome, actionCounts);

    return {
      agentId: input.agentId,
      metadata: {
        actionCounts,
        evidenceRefs: input.evidenceRefs ?? [],
        localDate: input.localDate,
        outcome,
        receiptIds: getReceiptIds(input.result),
        ...(input.result.sourceId ? { sourceId: input.result.sourceId } : {}),
        timezone: input.timezone,
        windowEnd: input.reviewWindowEnd,
        windowStart: input.reviewWindowStart,
      },
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
 * - A writer whose `writeDailyBrief` method calls `BriefModel.create`
 */
export const createServerMaintenanceBriefWriter = (db: LobeChatDatabase, userId: string) => {
  const model = new BriefModel(db, userId);

  return {
    writeDailyBrief: (brief: MaintenanceBriefProjection) => model.create(brief),
  };
};
