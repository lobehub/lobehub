import { normalizeVerifySurface } from '@lobechat/const/verify';
import type {
  AcceptanceAttachment,
  AcceptanceCheckReviewAction,
  AcceptanceReviewAnnotation,
  AcceptanceStatus,
  AcceptanceSubjectType,
  VerifyAgentPlanConfig,
  VerifyCheckDecisionDetail,
  VerifyCheckItem,
  VerifyRunDecisionDetail,
  VerifySurface,
} from '@lobechat/types';
import debug from 'debug';

import { AcceptanceModel } from '@/database/models/acceptance';
import { AgentModel } from '@/database/models/agent';
import { DocumentModel } from '@/database/models/document';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyReportModel } from '@/database/models/verifyReport';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type {
  AcceptanceItem,
  VerifyCheckResultItem,
  VerifyRunItem,
} from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { TaskService } from '@/server/services/task';

import { computeFalseFlags } from './feedbackService';

const log = debug('lobe-server:verify-acceptance');

// ============================================
// Union view — the cross-round check merge (P-14: the complete inventory of
// acceptance checks, each with its final verdict + evidence; rounds demoted to
// provenance). Deterministically computed at read time — never stored, so it
// can't go stale.
// ============================================

type CheckState = 'passed' | 'failed' | 'uncertain' | 'not_executed';

const resultState = (result: VerifyCheckResultItem): CheckState => {
  const v = result.verdict ?? result.status;
  if (v === 'passed' || v === 'failed' || v === 'uncertain') return v;
  return 'uncertain';
};

export interface AcceptanceCheckHistoryEntry {
  roundIndex: number;
  state: CheckState;
  verifyRunId: string;
}

/**
 * One executed step of a check's iteration timeline. Carries the title THAT
 * round used (a superseded item keeps its own wording) so the evolution reads
 * as written, newest rendered first by the viewer.
 */
export interface AcceptanceTimelineEntry {
  /** The result row backing this step — the key its evidence attaches by. */
  resultId: string;
  roundIndex: number;
  state: CheckState;
  title: string;
  verifyRunId: string;
}

/** One row of the acceptance union: a check item merged across every round. */
export interface AcceptanceCheckRow {
  /**
   * Set when the item was planned in rounds AFTER the one that produced its
   * final result (it was carried forward without a re-run): the round the
   * evidence actually comes from.
   */
  carriedFromRound?: number;
  /** Grouping key for the union view (harness-authored page section / domain). */
  category: string | null;
  /** Passed now, but failed in at least one earlier round — a repaired check. */
  fixed: boolean;
  /** Verdict trail across rounds, oldest first — only rounds that produced a result. */
  history: AcceptanceCheckHistoryEntry[];
  /** The `checkItemId` every round agrees on (the successor id after folding). */
  id: string;
  /** First round whose plan (or results) named this check (or one it supersedes). */
  introducedAtRound: number;
  /** The latest plan snapshot of this item (carries method/expected/requiredEvidence). */
  planItem?: VerifyCheckItem;
  required: boolean;
  /** The final (latest-round) result row, or undefined when the item never ran. */
  result?: VerifyCheckResultItem;
  /** Round the final result came from. */
  resultRound?: number;
  /** How many executed steps the timeline holds (re-runs + folded generations). */
  revisions: number;
  /**
   * Stable 1-based label across the whole union ("C3") — first-appearance
   * order over the round chain, so earlier rounds' numbering never shifts when
   * a new round lands. Feedback and annotations reference checks by it.
   * (Folding a superseded generation removes its row, so numbering after the
   * folded id shifts by one — the successor keeps its own slot.)
   */
  seq: number;
  /** Final cross-round state — what the decision is made on. */
  state: CheckState;
  /** Ids folded into this row via `supersedes` declarations. */
  supersededIds: string[];
  /** Per-item product surface (from the plan item's `verifierConfig.surface`). */
  surface: VerifySurface | null;
  /** The executed steps, oldest first — drives the iteration-history timeline. */
  timeline: AcceptanceTimelineEntry[];
  title: string;
  /** The wording evolved across the timeline (a real iteration, not a re-run). */
  titleChanged: boolean;
}

interface RoundInput {
  results: VerifyCheckResultItem[];
  run: VerifyRunItem;
}

const itemSurface = (item: VerifyCheckItem | undefined): VerifySurface | null => {
  const raw = (item?.verifierConfig as VerifyAgentPlanConfig | undefined)?.surface;
  return typeof raw === 'string' ? normalizeVerifySurface(raw) : null;
};

/**
 * Merge a whole round chain into the union check list.
 *
 * Alignment is two-layered, both harness-authored (no fuzzy matching):
 * - the stable `checkItemId` aligns re-runs of the same check across rounds;
 * - a plan item's `supersedes` folds the ids of checks it REPLACES into this
 *   item's iteration timeline, so a semantically-dead older wording stops
 *   showing up as its own row.
 */
export const buildAcceptanceCheckUnion = (rounds: RoundInput[]): AcceptanceCheckRow[] => {
  const ordered = [...rounds].sort((a, b) => (a.run.roundIndex ?? 0) - (b.run.roundIndex ?? 0));

  const rows = new Map<string, AcceptanceCheckRow>();
  // Last round whose PLAN named each item — drives the carried-forward flag.
  const lastPlannedRound = new Map<string, number>();

  const ensureRow = (id: string, roundIndex: number): AcceptanceCheckRow => {
    const existing = rows.get(id);
    if (existing) return existing;
    const row: AcceptanceCheckRow = {
      category: null,
      fixed: false,
      history: [],
      id,
      introducedAtRound: roundIndex,
      required: true,
      revisions: 0,
      seq: 0,
      state: 'not_executed',
      supersededIds: [],
      surface: null,
      timeline: [],
      title: id,
      titleChanged: false,
    };
    rows.set(id, row);
    return row;
  };

  for (const { results, run } of ordered) {
    const roundIndex = run.roundIndex ?? 0;
    const plan = (run.plan ?? []) as VerifyCheckItem[];
    const planById = new Map(plan.map((item) => [item.id, item]));

    for (const item of plan) {
      const row = ensureRow(item.id, roundIndex);
      // The latest snapshot wins: repair rounds may refine method/expected.
      row.planItem = item;
      row.title = item.title;
      row.required = item.required;
      row.category = item.category ?? row.category;
      row.surface = itemSurface(item) ?? row.surface;
      lastPlannedRound.set(item.id, roundIndex);
    }

    for (const result of results) {
      const row = ensureRow(result.checkItemId, roundIndex);
      const state = resultState(result);
      // The title THIS round used — the current round's snapshot, not the final one.
      const roundTitle =
        planById.get(result.checkItemId)?.title ?? result.checkItemTitle ?? row.title;
      row.history.push({ roundIndex, state, verifyRunId: run.id });
      row.timeline.push({
        resultId: result.id,
        roundIndex,
        state,
        title: roundTitle,
        verifyRunId: run.id,
      });
      row.result = result;
      row.resultRound = roundIndex;
      if (!row.planItem && result.checkItemTitle) row.title = result.checkItemTitle;
      if (!row.planItem) row.required = result.required;
    }
  }

  // Fold superseded generations into their successor's timeline, in round
  // order so a chain (C replaced by B replaced by A) collapses fully into A.
  const foldOrder = [...rows.values()].sort((a, b) => a.introducedAtRound - b.introducedAtRound);
  for (const row of foldOrder) {
    const supersedes = row.planItem?.supersedes ?? [];
    for (const oldId of supersedes) {
      const old = rows.get(oldId);
      if (!old || old === row) continue;
      row.timeline = [...old.timeline, ...row.timeline].sort((a, b) => a.roundIndex - b.roundIndex);
      row.history = [...old.history, ...row.history].sort((a, b) => a.roundIndex - b.roundIndex);
      row.introducedAtRound = Math.min(row.introducedAtRound, old.introducedAtRound);
      row.supersededIds = [...row.supersededIds, ...old.supersededIds, old.id];
      // The successor's own state stands; a never-run successor inherits the
      // superseded item's final result so the row still shows evidence.
      if (!row.result && old.result) {
        row.result = old.result;
        row.resultRound = old.resultRound;
      }
      rows.delete(oldId);
    }
  }

  // Number the surviving rows by first appearance (Map insertion order) —
  // stable as rounds accrue, because a new round only appends new ids.
  let seq = 0;
  for (const row of rows.values()) row.seq = ++seq;

  for (const row of rows.values()) {
    row.state = row.result ? resultState(row.result) : 'not_executed';
    row.fixed = row.state === 'passed' && row.history.some((entry) => entry.state === 'failed');
    row.revisions = row.timeline.length;
    row.titleChanged = row.timeline.some((entry) => entry.title !== row.title);
    // Carried forward: a later round still planned the item but never re-ran it,
    // so the final evidence predates the current round.
    const planned = lastPlannedRound.get(row.id);
    if (row.resultRound !== undefined && planned !== undefined && planned > row.resultRound) {
      row.carriedFromRound = row.resultRound;
    }
  }

  return [...rows.values()];
};

// ============================================
// User review overlay — the per-check human verdict layered onto the union.
// An accept is sticky across rounds; a reject binds to the round it judged and
// demotes to iteration history once a newer round lands.
// ============================================

/** The standing user verdict on one union row, derived from its result rows. */
export interface AcceptanceCheckUserReview {
  action: AcceptanceCheckReviewAction;
  annotations?: AcceptanceReviewAnnotation[];
  /** Attachments backing a reject, resolved to URLs by the bundle read. */
  attachments?: AcceptanceAttachment[];
  comment?: string;
  createdAt: string;
  roundIndex: number;
  /**
   * A reject made against a round older than the current one — the feedback
   * was (or is being) consumed by a newer round, so the check is back to
   * awaiting the user's confirmation instead of standing rejected.
   */
  stale: boolean;
}

/**
 * One user decision on one executed step of a check, projected out of the
 * result rows (`user_decision` + `user_decision_detail`) — no dedicated store:
 * each round's row keeps the decision the user made on THAT round's evidence.
 */
export interface AcceptanceCheckReviewEvent {
  action: AcceptanceCheckReviewAction;
  annotations?: AcceptanceReviewAnnotation[];
  /** Attachments backing the reject, resolved to URLs by the bundle read. */
  attachments?: AcceptanceAttachment[];
  comment?: string;
  /** When the decision was made (ISO 8601; falls back to the row's timestamps). */
  createdAt: string;
  /** Uploaded/pasted screenshots backing the reject (FKs to files). */
  fileIds?: string[];
  /** The result row the decision is stamped on. */
  id: string;
  roundIndex: number;
}

export interface AcceptanceCheckReviewOverlay {
  /** The full review trail for this check, oldest first — the iteration history input. */
  reviews: AcceptanceCheckReviewEvent[];
  /** The newest review, with its staleness resolved against the current round. */
  userReview?: AcceptanceCheckUserReview;
}

/**
 * Project a union row's review trail + standing user verdict from its result
 * rows. Superseded generations' decisions ride along automatically — the union
 * already folded their results into this row's timeline.
 */
export const buildCheckReviewOverlay = (
  check: Pick<AcceptanceCheckRow, 'timeline'>,
  resultsById: Map<string, VerifyCheckResultItem>,
  currentRoundIndex: number,
): AcceptanceCheckReviewOverlay => {
  const reviews: AcceptanceCheckReviewEvent[] = [];
  for (const entry of check.timeline) {
    const result = resultsById.get(entry.resultId);
    const decision = result?.userDecision;
    if (!result || (decision !== 'accepted' && decision !== 'rejected')) continue;
    const detail = result.userDecisionDetail ?? undefined;
    reviews.push({
      action: decision === 'accepted' ? 'accept' : 'reject',
      annotations: detail?.annotations,
      comment: detail?.comment,
      createdAt: detail?.decidedAt ?? (result.completedAt ?? result.createdAt)?.toISOString() ?? '',
      fileIds: detail?.fileIds,
      id: result.id,
      // A carried-forward check is judged at the CURRENT round even though its
      // evidence row belongs to an older one — the detail records that round.
      roundIndex: detail?.roundIndex ?? entry.roundIndex,
    });
  }
  // ISO strings order lexically; ties (legacy rows without decidedAt) keep round order.
  reviews.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.roundIndex - b.roundIndex);

  const latest = reviews.at(-1);
  if (!latest) return { reviews };
  return {
    reviews,
    userReview: {
      action: latest.action,
      annotations: latest.annotations,
      comment: latest.comment,
      createdAt: latest.createdAt,
      roundIndex: latest.roundIndex,
      stale: latest.action === 'reject' && latest.roundIndex < currentRoundIndex,
    },
  };
};

// ============================================
// Status rollup — the aggregate's user-facing lifecycle state, derived from the
// current (highest) round. `accepted` is terminal and user-owned: recompute
// never overwrites it. `rejected` holds until a newer round re-opens the loop.
// ============================================

/** Derive the aggregate status from the current round's pipeline state. */
const statusFromRound = (run: VerifyRunItem, hasReport: boolean): AcceptanceStatus => {
  switch (run.status) {
    case 'planned': {
      return 'planned';
    }
    case 'verifying': {
      return 'verifying';
    }
    case 'repairing': {
      return 'repairing';
    }
    case 'errored': {
      return 'errored';
    }
    // Both settled outcomes await the same human decision — the verdict is
    // advice, acceptance is the user's event (P-12).
    case 'passed':
    case 'failed':
    case 'delivered': {
      return 'delivered';
    }
    default: {
      // Ingested rounds carry no rollup status: a published report means the
      // round has settled and awaits the decision; otherwise it is still open.
      return hasReport ? 'delivered' : 'verifying';
    }
  }
};

export interface AcceptanceSubjectSummary {
  id: string;
  title: string | null;
  type: AcceptanceSubjectType;
}

export class AcceptanceService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  readonly acceptanceModel: AcceptanceModel;
  private readonly runModel: VerifyRunModel;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly evidenceModel: VerifyEvidenceModel;
  private readonly reportModel: VerifyReportModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.acceptanceModel = new AcceptanceModel(db, userId, workspaceId);
    this.runModel = new VerifyRunModel(db, userId, workspaceId);
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
    this.evidenceModel = new VerifyEvidenceModel(db, userId, workspaceId);
    this.reportModel = new VerifyReportModel(db, userId, workspaceId);
  }

  /**
   * Validate the subject exists in the caller's scope before creating an
   * aggregate for it — the table deliberately has no FK (polymorphic subject),
   * so this is where dangling aggregates are prevented.
   */
  private assertSubjectExists = async (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
  ): Promise<void> => {
    const found = await this.findSubject(subjectType, subjectId);
    if (!found) {
      throw new Error(`${subjectType} "${subjectId}" not found in the current workspace`);
    }
  };

  private findSubject = async (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
  ): Promise<{ title: string | null } | null> => {
    switch (subjectType) {
      case 'task': {
        const task = await new TaskModel(this.db, this.userId, this.workspaceId).resolve(subjectId);
        return task ? { title: task.name ?? task.identifier } : null;
      }
      case 'topic': {
        const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(
          subjectId,
        );
        return topic ? { title: topic.title ?? null } : null;
      }
      case 'document': {
        const doc = await new DocumentModel(this.db, this.userId, this.workspaceId).findById(
          subjectId,
        );
        return doc ? { title: doc.title ?? null } : null;
      }
    }
  };

  /** Get (or create) the aggregate for a subject, validating the subject first. */
  ensureForSubject = async (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
    defaults?: { requirement?: string },
  ): Promise<AcceptanceItem> => {
    await this.assertSubjectExists(subjectType, subjectId);
    return this.acceptanceModel.ensureForSubject(subjectType, subjectId, defaults);
  };

  /**
   * Chain a run onto an acceptance as its next round, then re-derive the
   * aggregate status (a new round re-opens a rejected loop).
   */
  attachRun = async (runId: string, acceptanceId: string): Promise<VerifyRunItem> => {
    const acceptance = await this.acceptanceModel.findById(acceptanceId);
    if (!acceptance) throw new Error(`Acceptance "${acceptanceId}" not found`);

    // Idempotent for the re-ingest path (the CLI sidecar remembers the run):
    // an already-chained round keeps its index instead of being re-appended.
    const existing = await this.runModel.findById(runId);
    if (!existing) throw new Error(`Verify run "${runId}" not found in the current workspace`);
    if (existing.acceptanceId === acceptanceId) return existing;
    if (existing.acceptanceId) {
      throw new Error('This verify run already belongs to another acceptance');
    }

    // Rounds inherit the aggregate's visibility so a private acceptance's new
    // round never leaks through its own report URL.
    const run = await this.runModel.attachToAcceptance(runId, acceptanceId, acceptance.visibility);
    await this.recomputeStatus(acceptanceId);
    log('run %s attached to acceptance %s as round %d', runId, acceptanceId, run.roundIndex);
    return run;
  };

  /**
   * Re-derive the aggregate's lifecycle state from its current round. The
   * user's `accepted` is terminal; `rejected` is sticky until a round newer
   * than the decision arrives.
   */
  recomputeStatus = async (acceptanceId: string): Promise<AcceptanceStatus | null> => {
    const acceptance = await this.acceptanceModel.findById(acceptanceId);
    if (!acceptance) return null;
    if (acceptance.status === 'accepted') return 'accepted';

    const runs = await this.runModel.listByAcceptance(acceptanceId);
    const current = runs.at(-1);
    if (!current) return acceptance.status as AcceptanceStatus;

    // The rejected round stays rejected; only a NEWER round re-opens the loop.
    if (acceptance.status === 'rejected' && current.userDecision === 'reject') return 'rejected';

    const report = await this.reportModel.findByRun(current.id);
    const status = statusFromRound(current, Boolean(report));
    if (status !== acceptance.status) {
      await this.acceptanceModel.updateStatus(acceptanceId, status);
      log('acceptance %s → %s (from round %d)', acceptanceId, status, current.roundIndex);
    }
    return status;
  };

  /**
   * The user accepts the delivery — the terminal business event (P-12). Stamps
   * the decision on the current round, closes the aggregate, and best-effort
   * completes a task subject that verification alone didn't settle.
   */
  accept = async (acceptanceId: string, comment?: string): Promise<AcceptanceItem> => {
    const acceptance = await this.requireDecidableAcceptance(acceptanceId);

    await this.stampDecision(acceptanceId, 'accept', comment);
    await this.acceptanceModel.updateStatus(acceptanceId, 'accepted');

    if (acceptance.subjectType === 'task') await this.completeTaskSubject(acceptance.subjectId);

    return (await this.acceptanceModel.findById(acceptanceId))!;
  };

  /**
   * The user rejects the delivery. The comment is the re-tasking input: it is
   * recorded on the round's decision detail, where the next repair/verify round
   * picks it up. (Spawning the repair run itself is the runtime's job — for
   * agent-bound rounds via the repair pipeline, for ingested rounds via the
   * next `lh verify ingest-report`.)
   */
  reject = async (acceptanceId: string, comment: string): Promise<AcceptanceItem> => {
    await this.requireDecidableAcceptance(acceptanceId);

    await this.stampDecision(acceptanceId, 'reject', comment);
    await this.acceptanceModel.updateStatus(acceptanceId, 'rejected');

    return (await this.acceptanceModel.findById(acceptanceId))!;
  };

  /**
   * Record the user's verdict on one or more union checks (a group-level
   * "accept all" is just many ids). Stamps `user_decision` +
   * `user_decision_detail` on each check's FINAL result row — the same data
   * flywheel every other decision path writes (FP/FN flags included). Unlike
   * the aggregate-level accept/reject, a per-check review is allowed at any
   * lifecycle state — confirming a check mid-chain is exactly the point.
   */
  reviewChecks = async (
    acceptanceId: string,
    input: {
      action: AcceptanceCheckReviewAction;
      annotations?: AcceptanceReviewAnnotation[];
      checkItemIds: string[];
      comment?: string;
      fileIds?: string[];
    },
  ): Promise<{ resultIds: string[] }> => {
    const acceptance = await this.acceptanceModel.findById(acceptanceId);
    if (!acceptance) throw new Error(`Acceptance "${acceptanceId}" not found`);

    const { results, runs } = await this.loadRounds(acceptanceId);

    // Reviews address union rows — resolve each id (or a superseded alias) to
    // its row, so a stale client can't stamp junk ids.
    const resultsByRun = new Map<string, VerifyCheckResultItem[]>();
    for (const result of results) {
      const bucket = resultsByRun.get(result.verifyRunId!) ?? [];
      bucket.push(result);
      resultsByRun.set(result.verifyRunId!, bucket);
    }
    const checks = buildAcceptanceCheckUnion(
      runs.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
    );
    const rowById = new Map<string, AcceptanceCheckRow>();
    for (const check of checks) {
      rowById.set(check.id, check);
      for (const oldId of check.supersededIds) rowById.set(oldId, check);
    }

    const unknown = input.checkItemIds.filter((id) => !rowById.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown check item(s): ${unknown.join(', ')}`);
    }

    // The decision is stamped on evidence — a never-executed check has no
    // result row to judge, so it cannot be reviewed yet.
    const targets = new Map<string, VerifyCheckResultItem>();
    const notExecuted: string[] = [];
    for (const id of input.checkItemIds) {
      const row = rowById.get(id)!;
      if (row.result) targets.set(row.result.id, row.result);
      else notExecuted.push(id);
    }
    if (notExecuted.length > 0) {
      throw new Error(`Check(s) never executed — nothing to review: ${notExecuted.join(', ')}`);
    }

    const decision = input.action === 'accept' ? 'accepted' : 'rejected';
    const currentRoundIndex = runs.at(-1)?.roundIndex ?? 0;
    const detail: VerifyCheckDecisionDetail = {
      decidedAt: new Date().toISOString(),
      decidedBy: this.userId,
      roundIndex: currentRoundIndex,
      ...(input.comment ? { comment: input.comment } : {}),
      ...(input.annotations?.length ? { annotations: input.annotations } : {}),
      ...(input.fileIds?.length ? { fileIds: input.fileIds } : {}),
    };

    await Promise.all(
      [...targets.values()].map((result) => {
        const { isFalsePositive, isFalseNegative } = computeFalseFlags(result.verdict, decision);
        return this.resultModel.update(result.id, {
          isFalseNegative,
          isFalsePositive,
          userDecision: decision,
          userDecisionDetail: detail,
        });
      }),
    );
    log('acceptance %s: %d check result(s) marked %s', acceptanceId, targets.size, decision);
    return { resultIds: [...targets.keys()] };
  };

  /**
   * A user decision needs a SETTLED round to judge (`delivered`, or `errored`
   * — the verifier could not run, the user may still take or refuse the
   * delivery). Deciding mid-flight would stamp a terminal state (and possibly
   * complete a task) before any report/verdict exists, and `recomputeStatus`
   * treats `accepted` as sticky, so a premature accept could never be
   * corrected by the pipeline.
   */
  private requireDecidableAcceptance = async (acceptanceId: string): Promise<AcceptanceItem> => {
    const acceptance = await this.acceptanceModel.findById(acceptanceId);
    if (!acceptance) throw new Error(`Acceptance "${acceptanceId}" not found`);
    if (acceptance.status === 'accepted') {
      throw new Error('This delivery has already been accepted');
    }
    if (acceptance.status === 'rejected') {
      throw new Error('This delivery was rejected — the next verification round re-opens it');
    }
    if (acceptance.status !== 'delivered' && acceptance.status !== 'errored') {
      throw new Error(
        `Verification is still in progress (${acceptance.status}) — the decision comes once the round settles`,
      );
    }
    return acceptance;
  };

  private stampDecision = async (
    acceptanceId: string,
    decision: 'accept' | 'reject',
    comment?: string,
  ): Promise<void> => {
    const runs = await this.runModel.listByAcceptance(acceptanceId);
    const current = runs.at(-1);
    if (!current) throw new Error('This acceptance has no verification round to decide on');

    const detail: VerifyRunDecisionDetail = {
      decidedAt: new Date().toISOString(),
      decidedBy: this.userId,
      ...(comment ? { comment } : {}),
    };
    await this.runModel.setDecision(current.id, decision, detail);
  };

  /**
   * Accepting a task subject completes the task when verification didn't
   * already (e.g. the round failed but the user accepted anyway). Best-effort:
   * a task error must not undo the recorded acceptance.
   */
  private completeTaskSubject = async (subjectId: string): Promise<void> => {
    try {
      const taskModel = new TaskModel(this.db, this.userId, this.workspaceId);
      const task = await taskModel.resolve(subjectId);
      if (!task || ['canceled', 'completed', 'failed'].includes(task.status)) return;

      // TaskService cascades checkpoint / sibling rollup / downstream unlock —
      // the same completion path settle.ts drives on a passed verify.
      await new TaskService(this.db, this.userId, this.workspaceId).updateStatus({
        id: task.id,
        status: 'completed',
      });
      log('acceptance accepted → task %s completed', task.id);
    } catch (error) {
      log('completeTaskSubject failed (non-fatal): %O', error);
    }
  };

  /** Best-effort subject header info for the bundle (title may be gone). */
  resolveSubject = async (acceptance: AcceptanceItem): Promise<AcceptanceSubjectSummary> => {
    let title: string | null = null;
    try {
      title =
        (
          await this.findSubject(
            acceptance.subjectType as AcceptanceSubjectType,
            acceptance.subjectId,
          )
        )?.title ?? null;
    } catch (error) {
      log('resolveSubject failed (non-fatal): %O', error);
    }
    return {
      id: acceptance.subjectId,
      title,
      type: acceptance.subjectType as AcceptanceSubjectType,
    };
  };

  /**
   * Recent aggregates with their subject headers — the list-panel payload.
   * Titles resolve in parallel per row (bounded by the list limit); a deleted
   * subject degrades to a null title instead of dropping the row.
   */
  listWithSubjects = async (limit = 50) => {
    const rows = await this.acceptanceModel.query(limit);
    return Promise.all(
      rows.map(async (row) => ({ ...row, subject: await this.resolveSubject(row) })),
    );
  };

  /**
   * The authoring conversation behind the round chain, resolved to displayable
   * entities (agent avatar/title, topic title). Owner-only header data — the
   * bundle must not include it for anonymous link holders.
   */
  resolveOrigin = async (
    runs: VerifyRunItem[],
  ): Promise<{
    agent: {
      avatar: string | null;
      backgroundColor: string | null;
      id: string;
      title: string | null;
    } | null;
    topic: { id: string; title: string | null } | null;
  } | null> => {
    const origin = [...runs].reverse().find((run) => run.metadata?.origin)?.metadata?.origin;
    if (!origin?.agentId && !origin?.topicId) return null;

    const [agent, topic] = await Promise.all([
      origin.agentId
        ? new AgentModel(this.db, this.userId, this.workspaceId)
            .getAgentAvatarsByIds([origin.agentId])
            .then((rows) => rows[0] ?? null)
            .catch(() => null)
        : null,
      origin.topicId
        ? new TopicModel(this.db, this.userId, this.workspaceId)
            .findById(origin.topicId)
            .then((row) => (row ? { id: row.id, title: row.title ?? null } : null))
            .catch(() => null)
        : null,
    ]);
    if (!agent && !topic) return null;
    return { agent, topic };
  };

  /** The rounds + their per-round data the bundle and the union both read. */
  loadRounds = async (acceptanceId: string) => {
    const runs = await this.runModel.listByAcceptance(acceptanceId);
    const runIds = runs.map((r) => r.id);
    const [results, evidence, reports] = await Promise.all([
      this.resultModel.listByRuns(runIds),
      this.evidenceModel.listByRuns(runIds),
      this.reportModel.findByRuns(runIds),
    ]);
    return { evidence, reports, results, runs };
  };
}
