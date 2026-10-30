import type {
  AcceptanceSubjectType,
  AcceptanceVisibility,
  VerifierType,
  VerifyCheckResultStatus,
  VerifyEvidenceCapturedBy,
  VerifyEvidenceType,
  VerifyRunSource,
  VerifyRunStatus,
  VerifyUserDecision,
  VerifyVerdict,
  VerifyVisibility,
} from '@lobechat/const/verify';
import { acceptanceSubjectTypes } from '@lobechat/const/verify';
import type {
  AcceptanceCheckReviewAction,
  AcceptanceCommentItem,
  AcceptanceCommentList,
  AcceptanceConfig,
  AcceptanceMetadata,
  AcceptanceReviewAnnotation,
  AcceptanceStatus,
  AcceptanceVisualRender,
  ToulminVerdict,
  VerifyCheckDecisionDetail,
  VerifyCheckItem,
  VerifyCheckResultMetadata,
  VerifyFlowSnapshot,
  VerifyRunContext,
  VerifyRunDecisionDetail,
  VerifyRunMetadata,
  VerifyRunScenario,
} from '@lobechat/types';

import {
  type AcceptanceCheckRow,
  type AcceptanceTimelineEntry,
  buildAcceptanceCheckUnion,
} from './acceptanceCheckUnion';
import {
  type AcceptanceCheckReviewEvent,
  type AcceptanceCheckUserReview,
  buildCheckReviewOverlay,
} from './acceptanceReviewOverlay';
import { statusFromRound } from './acceptanceStatus';

// ============================================
// Local acceptance — the same acceptance page, read from `.acceptances/`
// instead of the server. The CLI reads each round directory into the rows an
// ingest would publish; this module folds them (plus the reviewer's local
// decisions) into the bundle the acceptance viewer renders, with the same
// union, review overlay and status rollup the server uses. Everything here is
// pure and JSON-in: the CLI runs it for `view` / `feedback`, and the offline
// report page runs it again in the browser after every review.
// ============================================

export const LOCAL_ACCEPTANCE_FORMAT = 1;

/** The account every local row is owned by — there is no account. */
export const LOCAL_ACCEPTANCE_USER_ID = 'local';

/** ISO 8601 timestamp, as stored in `acceptance.json`, `reviews.json` and the page data. */
type IsoDate = string;

/** `acceptance.json` — the identity of one local acceptance directory. */
export interface LocalAcceptanceInfo {
  createdAt: IsoDate;
  /** Stable local id (a UUID), minted on the first render and kept forever. */
  id: string;
  /** Present once the rounds were published to LobeHub with `lh acceptance publish`. */
  remote?: LocalAcceptanceRemote;
  /** The durable business goal; immutable once recorded, like the server's. */
  requirement: string | null;
  /** The directory name under `.acceptances/` (`standalone-<slug>`, `task-T-12`, …). */
  subjectKey: string;
}

export interface LocalAcceptanceRemote {
  acceptanceId: string;
  acceptanceUrl: string;
  /**
   * Local review decisions already carried onto the published acceptance, so a
   * re-publish never replays one over a collaborator's newer decision online.
   */
  carriedReviews?: string[];
  /** Round directories already published, oldest first, with the run each became. */
  rounds: {
    dir: string;
    /** Local evidence id → its upload's id. An artifact that failed to upload is absent. */
    evidence?: Record<string, string>;
    roundIndex: number | null;
    verifyRunId: string;
  }[];
}

export interface LocalRunSource {
  context: VerifyRunContext | null;
  createdAt: IsoDate;
  goal: string | null;
  id: string;
  metadata: VerifyRunMetadata | null;
  plan: VerifyCheckItem[] | null;
  roundIndex: number;
  scenario: VerifyRunScenario | null;
  title: string | null;
}

export interface LocalResultSource {
  checkItemId: string;
  checkItemIndex: number;
  checkItemTitle: string;
  createdAt: IsoDate;
  id: string;
  metadata: VerifyCheckResultMetadata | null;
  required: boolean;
  suggestion: string | null;
  toulmin: ToulminVerdict | null;
  verdict: VerifyVerdict;
}

export interface LocalEvidenceSource {
  checkResultId: string;
  content: string | null;
  createdAt: IsoDate;
  description: string | null;
  fileHeight: number | null;
  fileName: string | null;
  /** Path relative to the acceptance directory (where `report.html` lives). */
  fileUrl: string | null;
  fileWidth: number | null;
  id: string;
  metadata: unknown;
  type: VerifyEvidenceType;
}

export interface LocalReportSource {
  content: string | null;
  failedChecks: number | null;
  overallConfidence: number | null;
  passedChecks: number | null;
  summary: string | null;
  totalChecks: number | null;
  uncertainChecks: number | null;
  verdict: VerifyVerdict | null;
}

/** One round directory, read into the rows an ingest would publish. */
export interface LocalRoundSource {
  /** The round directory name, relative to the acceptance directory. */
  dir: string;
  evidence: LocalEvidenceSource[];
  /** `proposal.md` — the round's note to the reviewer. */
  proposal: string | null;
  report: LocalReportSource | null;
  results: LocalResultSource[];
  run: LocalRunSource;
}

/**
 * One reviewer decision, appended to the acceptance's local review log.
 *
 * A check decision names the RESULT rows it judged, resolved when it was
 * made: a later round re-runs the check into a new row, and the decision must
 * stay on the evidence it was made against — exactly what the server's
 * `user_decision` column does.
 */
export type LocalReviewEvent =
  | {
      action: AcceptanceCheckReviewAction;
      annotations?: AcceptanceReviewAnnotation[];
      comment?: string;
      createdAt: IsoDate;
      id: string;
      kind: 'checks';
      roundIndex: number;
      targets: { checkId: string; resultId: string }[];
    }
  | {
      category: string;
      comment: string;
      createdAt: IsoDate;
      id: string;
      kind: 'group';
      roundIndex: number;
    }
  | {
      /**
       * The reviewer's decision on the whole delivery of `roundIndex` — what
       * `acceptance.accept` / `acceptance.reject` stamp on the current round.
       */
      action: LocalDeliveryDecision;
      comment?: string;
      createdAt: IsoDate;
      id: string;
      kind: 'decision';
      roundIndex: number;
    };

export type LocalDeliveryDecision = 'accept' | 'reject';

/** `reviews.json` — the local review log of one acceptance. */
export interface LocalReviewLog {
  acceptanceId: string;
  events: LocalReviewEvent[];
  format: typeof LOCAL_ACCEPTANCE_FORMAT;
}

/** Everything a local report renders from — what the CLI embeds into `report.html`. */
export interface LocalAcceptanceSource {
  acceptance: LocalAcceptanceInfo;
  format: typeof LOCAL_ACCEPTANCE_FORMAT;
  generatedAt: IsoDate;
  reviews: LocalReviewEvent[];
  rounds: LocalRoundSource[];
}

// --- the bundle rows, shaped like the server's ---

interface LocalAcceptanceRow {
  accessedAt: Date;
  completedAt: Date | null;
  config: AcceptanceConfig | null;
  createdAt: Date;
  id: string;
  metadata: AcceptanceMetadata;
  projectId: string | null;
  requirement: string | null;
  status: AcceptanceStatus;
  subjectId: string;
  subjectType: AcceptanceSubjectType;
  updatedAt: Date;
  userId: string;
  visibility: AcceptanceVisibility;
  visualRender: AcceptanceVisualRender | null;
  workspaceId: string | null;
}

interface LocalRunRow {
  acceptanceId: string | null;
  accessedAt: Date;
  context: VerifyRunContext | null;
  createdAt: Date;
  decisionDetail: VerifyRunDecisionDetail | null;
  flowSnapshots: VerifyFlowSnapshot[] | null;
  goal: string | null;
  id: string;
  metadata: VerifyRunMetadata | null;
  operationId: string | null;
  plan: VerifyCheckItem[] | null;
  planConfirmedAt: Date | null;
  roundIndex: number | null;
  scenario: VerifyRunScenario | null;
  source: VerifyRunSource;
  status: VerifyRunStatus | null;
  title: string | null;
  updatedAt: Date;
  userDecision: string | null;
  userId: string;
  visibility: VerifyVisibility;
  workspaceId: string | null;
}

export interface LocalResultRow {
  checkItemId: string;
  checkItemIndex: number | null;
  checkItemTitle: string | null;
  completedAt: Date | null;
  confidence: number | null;
  createdAt: Date;
  id: string;
  isFalseNegative: boolean | null;
  isFalsePositive: boolean | null;
  metadata: VerifyCheckResultMetadata | null;
  operationId: string | null;
  repairOperationId: string | null;
  required: boolean;
  sourceCriterionId: string | null;
  startedAt: Date | null;
  status: VerifyCheckResultStatus;
  suggestion: string | null;
  toulmin: ToulminVerdict | null;
  userDecision: VerifyUserDecision | null;
  userDecisionDetail: VerifyCheckDecisionDetail | null;
  userId: string;
  verdict: VerifyVerdict | null;
  verifierConfigHash: string | null;
  verifierOperationId: string | null;
  verifierTracingId: string | null;
  verifierType: VerifierType;
  verifyRunId: string | null;
  workspaceId: string | null;
}

export interface LocalEvidenceRow {
  capturedAt: Date | null;
  capturedBy: VerifyEvidenceCapturedBy | null;
  checkItemId: string;
  checkResultId: string;
  content: string | null;
  createdAt: Date;
  description: string | null;
  documentId: string | null;
  fileHeight: number | null;
  fileId: string | null;
  fileName: string | null;
  fileUrl: string | null;
  fileWidth: number | null;
  id: string;
  metadata: unknown;
  type: VerifyEvidenceType;
  userId: string;
  verifyRunId: string;
  workspaceId: string | null;
}

interface LocalReportRow {
  content: string | null;
  createdAt: Date;
  failedChecks: number | null;
  generatedAt: Date;
  generatedBy: string | null;
  id: string;
  operationId: string | null;
  overallConfidence: number | null;
  passedChecks: number | null;
  reviewedByUser: boolean | null;
  summary: string | null;
  totalChecks: number | null;
  uncertainChecks: number | null;
  userId: string;
  verdict: VerifyVerdict | null;
  verifyRunId: string | null;
  workspaceId: string | null;
}

/** A pull request the rounds name — a hand link nothing has vouched for. */
interface LocalPullRequest {
  ciStatus: null;
  isDraft: boolean;
  mergedAt: Date | null;
  number: number;
  provider: string;
  repoFullName: string;
  reviewDecision: null;
  source: 'manual';
  state: null;
  title: string | null;
  url: string;
}

type LocalCheck = Omit<AcceptanceCheckRow<LocalResultRow>, 'timeline'> & {
  evidence: LocalEvidenceRow[];
  prediction: null;
  predictionStatus: null;
  reviews: AcceptanceCheckReviewEvent[];
  timeline: (AcceptanceTimelineEntry & { evidence: LocalEvidenceRow[] })[];
  userReview: AcceptanceCheckUserReview | undefined;
};

/** The acceptance bundle of a local acceptance — the server's `getBundle` shape. */
export interface LocalAcceptanceBundle {
  acceptance: LocalAcceptanceRow;
  /** Whoever ran the agent on this machine — there is no account to name. */
  author: { avatar: string | null; fullName: string | null; id: string; username: string | null };
  canCollaborate: false;
  canReject: boolean;
  /** Feedback hand-offs to an agent are a LobeHub feature. */
  canRequestRepair: false;
  canReview: boolean;
  checks: LocalCheck[];
  collaboration: null;
  flows: never[];
  isOwner: boolean;
  latestReport: LocalReportRow | null;
  origin: null;
  pullRequests: LocalPullRequest[];
  repair: null;
  repairDispatchAvailable: false;
  repairSource: null;
  rounds: { report: LocalReportRow | null; run: LocalRunRow; usage: null }[];
  subject: { id: string; title: string | null; type: AcceptanceSubjectType };
}

const date = (value: IsoDate | null | undefined, fallback: Date) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const decisionFor = (action: AcceptanceCheckReviewAction): VerifyUserDecision =>
  action === 'accept' ? 'accepted' : action === 'ignore' ? 'overridden' : 'rejected';

/** `task-T-12` → task subject; anything unrecognized (and `standalone-*`) is standalone. */
export const localSubjectFromKey = (
  subjectKey: string,
): { id: string; type: AcceptanceSubjectType } => {
  const separator = subjectKey.indexOf('-');
  const type = subjectKey.slice(0, separator) as AcceptanceSubjectType;
  if (
    separator > 0 &&
    type !== 'standalone' &&
    (acceptanceSubjectTypes as readonly string[]).includes(type)
  )
    return { id: subjectKey.slice(separator + 1), type };
  return { id: subjectKey, type: 'standalone' };
};

const GITHUB_PULL = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i;

const pullRequestsOf = (rounds: LocalRunRow[]): LocalPullRequest[] => {
  const seen = new Map<string, LocalPullRequest>();
  for (const run of rounds) {
    const context = run.context as { pullRequest?: { title?: unknown; url?: unknown } } | null;
    const url = typeof context?.pullRequest?.url === 'string' ? context.pullRequest.url : null;
    const match = url?.match(GITHUB_PULL);
    if (!url || !match) continue;
    seen.set(url.toLowerCase(), {
      ciStatus: null,
      isDraft: false,
      mergedAt: null,
      number: Number(match[2]),
      provider: 'github',
      repoFullName: match[1]!,
      reviewDecision: null,
      source: 'manual',
      state: null,
      title: typeof context?.pullRequest?.title === 'string' ? context.pullRequest.title : null,
      url,
    });
  }
  return [...seen.values()];
};

/**
 * Fold a local acceptance into the bundle the acceptance viewer renders.
 *
 * Review events are applied in order onto the rows they name, the way the
 * server stamps `user_decision` (a later decision on the same row replaces the
 * earlier one) and appends group feedback to the round's decision detail.
 */
export const assembleLocalAcceptance = (source: LocalAcceptanceSource): LocalAcceptanceBundle => {
  const { acceptance: info } = source;
  const createdAt = date(info.createdAt, new Date(0));
  const ordered = [...source.rounds].sort((a, b) => a.run.roundIndex - b.run.roundIndex);

  const runs: LocalRunRow[] = ordered.map(({ run }) => {
    const runCreatedAt = date(run.createdAt, createdAt);
    return {
      acceptanceId: info.id,
      accessedAt: runCreatedAt,
      context: run.context,
      createdAt: runCreatedAt,
      decisionDetail: null,
      flowSnapshots: null,
      goal: run.goal,
      id: run.id,
      metadata: run.metadata,
      operationId: null,
      plan: run.plan,
      planConfirmedAt: null,
      roundIndex: run.roundIndex,
      scenario: run.scenario,
      source: 'agent-testing',
      status: null,
      title: run.title,
      updatedAt: runCreatedAt,
      userDecision: null,
      userId: LOCAL_ACCEPTANCE_USER_ID,
      visibility: 'private',
      workspaceId: null,
    };
  });
  const runByIndex = new Map(runs.map((run) => [run.roundIndex, run]));

  const resultsById = new Map<string, LocalResultRow>();
  const resultsByRun = new Map<string, LocalResultRow[]>();
  const evidenceByResult = new Map<string, LocalEvidenceRow[]>();
  const reports = new Map<string, LocalReportRow>();
  for (const [index, round] of ordered.entries()) {
    const run = runs[index]!;
    const rows = round.results.map((result): LocalResultRow => {
      const resultCreatedAt = date(result.createdAt, run.createdAt);
      return {
        checkItemId: result.checkItemId,
        checkItemIndex: result.checkItemIndex,
        checkItemTitle: result.checkItemTitle,
        completedAt: resultCreatedAt,
        confidence: null,
        createdAt: resultCreatedAt,
        id: result.id,
        isFalseNegative: null,
        isFalsePositive: null,
        metadata: result.metadata,
        operationId: null,
        repairOperationId: null,
        required: result.required,
        sourceCriterionId: null,
        startedAt: null,
        // Same rule as the server's ingest: only a pass settles as passed.
        status: result.verdict === 'passed' ? 'passed' : 'failed',
        suggestion: result.suggestion,
        toulmin: result.toulmin,
        userDecision: null,
        userDecisionDetail: null,
        userId: LOCAL_ACCEPTANCE_USER_ID,
        verdict: result.verdict,
        verifierConfigHash: null,
        verifierOperationId: null,
        verifierTracingId: null,
        verifierType: 'agent',
        verifyRunId: run.id,
        workspaceId: null,
      };
    });
    resultsByRun.set(run.id, rows);
    for (const row of rows) resultsById.set(row.id, row);

    const checkItemByResult = new Map(rows.map((row) => [row.id, row.checkItemId]));
    for (const evidence of round.evidence) {
      const checkItemId = checkItemByResult.get(evidence.checkResultId);
      if (!checkItemId) continue;
      const evidenceCreatedAt = date(evidence.createdAt, run.createdAt);
      const bucket = evidenceByResult.get(evidence.checkResultId) ?? [];
      bucket.push({
        capturedAt: evidenceCreatedAt,
        capturedBy: 'cli',
        checkItemId,
        checkResultId: evidence.checkResultId,
        content: evidence.content,
        createdAt: evidenceCreatedAt,
        description: evidence.description,
        documentId: null,
        fileHeight: evidence.fileHeight,
        fileId: evidence.fileUrl,
        fileName: evidence.fileName,
        fileUrl: evidence.fileUrl,
        fileWidth: evidence.fileWidth,
        id: evidence.id,
        metadata: evidence.metadata ?? null,
        type: evidence.type,
        userId: LOCAL_ACCEPTANCE_USER_ID,
        verifyRunId: run.id,
        workspaceId: null,
      });
      evidenceByResult.set(evidence.checkResultId, bucket);
    }

    if (round.report) {
      reports.set(run.id, {
        ...round.report,
        createdAt: run.createdAt,
        generatedAt: run.createdAt,
        generatedBy: 'agent',
        id: `${run.id}:report`,
        operationId: null,
        reviewedByUser: false,
        userId: LOCAL_ACCEPTANCE_USER_ID,
        verifyRunId: run.id,
        workspaceId: null,
      });
    }
  }

  for (const event of source.reviews) {
    if (event.kind === 'checks') {
      const detail: VerifyCheckDecisionDetail = {
        decidedAt: event.createdAt,
        decidedBy: LOCAL_ACCEPTANCE_USER_ID,
        roundIndex: event.roundIndex,
        ...(event.comment ? { comment: event.comment } : {}),
        ...(event.annotations?.length ? { annotations: event.annotations } : {}),
      };
      for (const target of event.targets) {
        const row = resultsById.get(target.resultId);
        if (!row) continue;
        row.userDecision = decisionFor(event.action);
        row.userDecisionDetail = detail;
      }
      continue;
    }
    const run = runByIndex.get(event.roundIndex);
    if (!run) continue;
    if (event.kind === 'decision') {
      // A later decision on the same round replaces the earlier one, as the
      // server's `setDecision` does; the round's group feedback stays.
      const groupFeedback = run.decisionDetail?.groupFeedback;
      run.userDecision = event.action;
      run.decisionDetail = {
        decidedAt: event.createdAt,
        decidedBy: LOCAL_ACCEPTANCE_USER_ID,
        ...(event.comment ? { comment: event.comment } : {}),
        ...(groupFeedback ? { groupFeedback } : {}),
      };
      continue;
    }
    run.decisionDetail = {
      ...run.decisionDetail,
      groupFeedback: [
        ...(run.decisionDetail?.groupFeedback ?? []),
        { category: event.category, comment: event.comment, createdAt: event.createdAt },
      ],
    };
  }

  const union = buildAcceptanceCheckUnion(
    runs.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
  );
  const currentRoundIndex = runs.at(-1)?.roundIndex ?? 0;
  const checks: LocalCheck[] = union.map((check) => {
    const { reviews, userReview } = buildCheckReviewOverlay(check, resultsById, currentRoundIndex);
    return {
      ...check,
      evidence: check.result ? (evidenceByResult.get(check.result.id) ?? []) : [],
      prediction: null,
      predictionStatus: null,
      reviews,
      timeline: check.timeline.map((entry) => ({
        ...entry,
        evidence: evidenceByResult.get(entry.resultId) ?? [],
      })),
      userReview,
    };
  });

  const rounds = runs.map((run) => ({ report: reports.get(run.id) ?? null, run, usage: null }));
  const latestReport = [...rounds].reverse().find((round) => round.report)?.report ?? null;
  const current = runs.at(-1);
  const updatedAt = current?.createdAt ?? createdAt;
  const subject = localSubjectFromKey(info.subjectKey);
  const title = current?.title || current?.goal || null;
  // Only a decision on the current round settles the delivery: a newer round
  // re-opens it, the way a new round re-opens a rejected acceptance online.
  const decision = current?.userDecision;
  const status: AcceptanceStatus =
    decision === 'accept'
      ? 'accepted'
      : decision === 'reject'
        ? 'rejected'
        : current
          ? statusFromRound(current, reports.has(current.id))
          : 'pending';

  return {
    acceptance: {
      accessedAt: updatedAt,
      completedAt:
        status === 'accepted' ? date(current?.decisionDetail?.decidedAt, updatedAt) : null,
      config: {},
      createdAt,
      id: info.id,
      metadata: title ? { title } : {},
      projectId: null,
      requirement: info.requirement,
      status,
      subjectId: subject.id,
      subjectType: subject.type,
      updatedAt,
      userId: LOCAL_ACCEPTANCE_USER_ID,
      visibility: 'private',
      visualRender: null,
      workspaceId: null,
    },
    author: { avatar: null, fullName: null, id: LOCAL_ACCEPTANCE_USER_ID, username: null },
    canCollaborate: false,
    canReject: true,
    canRequestRepair: false,
    canReview: true,
    checks,
    collaboration: null,
    flows: [],
    isOwner: true,
    latestReport,
    origin: null,
    pullRequests: pullRequestsOf(runs),
    repair: null,
    repairDispatchAvailable: false,
    repairSource: null,
    rounds,
    subject: { id: subject.id, title, type: subject.type },
  };
};

/**
 * The discussion of a local acceptance: each round's `proposal.md`, posted as
 * the round's own note the way ingest posts it. There is nobody else to talk
 * to — writing comments is what publishing to LobeHub is for.
 */
export const localAcceptanceComments = (source: LocalAcceptanceSource): AcceptanceCommentList => ({
  canApprove: false,
  canComment: false,
  canManageAccess: false,
  items: source.rounds
    .filter((round) => round.proposal?.trim())
    .map((round): AcceptanceCommentItem => {
      const at = date(round.run.createdAt, new Date(0));
      return {
        acceptanceId: source.acceptance.id,
        anchorType: 'acceptance',
        attachments: [],
        author: {
          avatar: null,
          fullName: null,
          id: null,
          status: 'active',
          type: 'agent',
          username: 'Agent',
        },
        authorAgentId: null,
        authorUserId: null,
        canDelete: false,
        clientId: `proposal:${round.run.id}`,
        content: round.proposal!.trim(),
        contextRoundIndex: round.run.roundIndex,
        contextRunId: round.run.id,
        createdAt: at,
        deletedAt: null,
        editorData: null,
        id: `proposal:${round.run.id}`,
        kind: 'proposal',
        parentCommentId: null,
        reactions: [],
        resolvedAt: null,
        resolvedByUserId: null,
        source: null,
        updatedAt: at,
      };
    }),
});

/**
 * Resolve the checks a reviewer decided on to the result rows the decision is
 * stamped on — the union row's final result, accepting a superseded id as an
 * alias of its successor. Same refusals as the server: an unknown id, or a
 * check that never ran (there is no evidence to judge).
 */
export const localReviewTargets = (
  bundle: Pick<LocalAcceptanceBundle, 'checks'>,
  checkIds: string[],
): { checkId: string; resultId: string }[] => {
  const byId = new Map<string, LocalCheck>();
  for (const check of bundle.checks) {
    byId.set(check.id, check);
    for (const oldId of check.supersededIds) byId.set(oldId, check);
  }
  const unknown = checkIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) throw new Error(`Unknown check item(s): ${unknown.join(', ')}`);
  const notExecuted = checkIds.filter((id) => !byId.get(id)!.result);
  if (notExecuted.length > 0)
    throw new Error(`Check(s) never executed — nothing to review: ${notExecuted.join(', ')}`);
  return checkIds.map((id) => {
    const check = byId.get(id)!;
    return { checkId: check.id, resultId: check.result!.id };
  });
};

/**
 * The reviewer's decision on the whole delivery, as the event the review log
 * records. Same refusals as the server's `requireDecidableAcceptance`: the
 * current round must have settled, and a decided delivery stays decided until
 * a newer round re-opens it.
 */
export const localDecisionEvent = (
  bundle: Pick<LocalAcceptanceBundle, 'acceptance' | 'rounds'>,
  input: { action: LocalDeliveryDecision; comment?: string; createdAt: IsoDate; id: string },
): Extract<LocalReviewEvent, { kind: 'decision' }> => {
  const { status } = bundle.acceptance;
  if (status === 'accepted') throw new Error('This delivery has already been accepted');
  if (status === 'rejected')
    throw new Error('This delivery was rejected — the next verification round re-opens it');
  if (status !== 'delivered' && status !== 'errored')
    throw new Error(
      `Verification is still in progress (${status}) — the decision comes once the round settles`,
    );
  const comment = input.comment?.trim();
  return {
    action: input.action,
    ...(comment ? { comment } : {}),
    createdAt: input.createdAt,
    id: input.id,
    kind: 'decision',
    roundIndex: bundle.rounds.at(-1)!.run.roundIndex!,
  };
};

/** Merge two review logs by event id, oldest first — an export re-read changes nothing. */
export const mergeLocalReviewEvents = (
  ...logs: (LocalReviewEvent[] | undefined)[]
): LocalReviewEvent[] => {
  const byId = new Map<string, LocalReviewEvent>();
  for (const events of logs) for (const event of events ?? []) byId.set(event.id, event);
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
};
