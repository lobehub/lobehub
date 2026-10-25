import { isDraftVerifyRun } from '@lobechat/const/verify';
import type {
  AcceptanceCheckGroup,
  AcceptanceConfig,
  AcceptanceStatus,
  AcceptanceSubjectType,
  VerifyCheckTally,
  VerifyRunDecisionDetail,
} from '@lobechat/types';
import debug from 'debug';

import { AcceptanceModel } from '@/database/models/acceptance';
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
import { notifyAcceptance } from '@/server/services/acceptanceReview/events';
import { ExpertiseRejectionWorkflow } from '@/server/workflows/expertiseRejection';

import { requireDecidableAcceptance } from '../acceptanceDecision';
import { type AcceptanceMergeSummary, mergeAcceptanceRounds } from '../acceptanceMerge';
import {
  assertPlanLeavesAcceptedChecksAlone,
  type AttachedRun,
  withUnresolvedSupersedes,
} from './attachGuards';
import { buildAcceptanceCheckUnion, tallyCheckUnion } from './checkUnion';
import type { AcceptanceServiceDeps, WithoutDeps } from './deps';
import {
  type AcceptanceListOptions,
  isInOwnScope,
  latestCheckCounts,
  resolveForeignSubjects,
  resolveProjects,
  resolveSubjects,
  statusesForFilter,
} from './listing';
import { findRepairOrigin, resolveOrigin } from './origin';
import { reviewChecks } from './reviewChecks';
import { statusFromRound } from './statusRollup';
import {
  type AcceptanceSubjectSummary,
  assertProjectExists,
  assertSubjectExists,
  resolveCanonicalSubjectId,
  resolveRunTopicTaskId,
  resolveSubject,
  resolveSubjectProjectId,
} from './subjects';
import {
  completeTaskForDelivery,
  completeTaskSubject,
  reopenRejectedTaskSubject,
} from './taskLifecycle';

export type { AttachedRun } from './attachGuards';
export type {
  AcceptanceCheckHistoryEntry,
  AcceptanceCheckRow,
  AcceptanceTimelineEntry,
} from './checkUnion';
export { buildAcceptanceCheckUnion, tallyCheckUnion } from './checkUnion';
export type { AcceptanceListFilter, AcceptanceListOptions } from './listing';
export type {
  AcceptanceCheckReviewEvent,
  AcceptanceCheckReviewOverlay,
  AcceptanceCheckUserReview,
} from './reviewOverlay';
export { buildCheckReviewOverlay } from './reviewOverlay';
export type { AcceptanceSubjectSummary } from './subjects';

const log = debug('lobe-server:verify-acceptance');

export class AcceptanceService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  readonly acceptanceModel: AcceptanceModel;
  private readonly runModel: VerifyRunModel;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly evidenceModel: VerifyEvidenceModel;
  private readonly reportModel: VerifyReportModel;

  /**
   * Who is CREDITED for the writes this service performs.
   *
   * Normally the same person the service is scoped to. They diverge for an
   * elevated write — a workspace owner acting on a teammate's delivery — where
   * the scope has to be the row's owner for the ownership predicate to resolve
   * it at all, while `decidedBy` must still name the human who decided. An
   * audit trail that credits a teammate's verdict to the author is worse than
   * one nobody can sign.
   */
  private readonly actorUserId: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    options?: { actorUserId?: string },
  ) {
    this.db = db;
    this.userId = userId;
    this.actorUserId = options?.actorUserId ?? userId;
    this.workspaceId = workspaceId;
    this.acceptanceModel = new AcceptanceModel(db, userId, workspaceId);
    this.runModel = new VerifyRunModel(db, userId, workspaceId);
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
    this.evidenceModel = new VerifyEvidenceModel(db, userId, workspaceId);
    this.reportModel = new VerifyReportModel(db, userId, workspaceId);
  }

  /** Collaborators the extracted sub-domain functions read — resolved on every call. */
  private get deps(): AcceptanceServiceDeps {
    return {
      acceptanceModel: this.acceptanceModel,
      actorUserId: this.actorUserId,
      db: this.db,
      loadRounds: this.loadRounds,
      resultModel: this.resultModel,
      runModel: this.runModel,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
  }

  /**
   * Get (or create) the aggregate for a subject, validating the subject first.
   *
   * Project precedence: a `projectId` the caller names (a CLI `--project`),
   * then the one the subject implies, then `fallbackProjectId` — the project
   * the delivery's repository declares, a default too broad to override a
   * task's or conversation's own project. Either way it only files an
   * aggregate that has no project yet: a delivery already grouped is moved by
   * hand, never by the next round.
   */
  ensureForSubject = async (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
    defaults?: {
      config?: AcceptanceConfig;
      fallbackProjectId?: string;
      projectId?: string;
      requirement?: string;
      title?: string;
    },
  ): Promise<AcceptanceItem> => {
    const canonicalId = await assertSubjectExists(this.deps, subjectType, subjectId);
    const projectId = defaults?.projectId
      ? await assertProjectExists(this.deps, defaults.projectId)
      : ((await resolveSubjectProjectId(this.deps, subjectType, canonicalId)) ??
        (defaults?.fallbackProjectId
          ? await assertProjectExists(this.deps, defaults.fallbackProjectId)
          : null));
    return this.acceptanceModel.ensureForSubject(subjectType, canonicalId, {
      config: defaults?.config,
      projectId,
      requirement: defaults?.requirement,
      ...(subjectType === 'standalone' && defaults?.title
        ? { metadata: { title: defaults.title } }
        : {}),
    });
  };

  /**
   * The ingest entry point (`lh acceptance run ingest`). An agent authoring its
   * own report inside a Task run only knows its topic, so a topic subject that
   * is a Task's run topic is folded onto that Task — otherwise the delivery
   * lands on a topic aggregate no task surface reads, and the Task page shows
   * no acceptance at all. A topic that already owns an acceptance keeps it, so
   * its earlier rounds are not split across two aggregates; recurring
   * (automation) tasks stay on their per-tick topic.
   */
  ensureForIngest = async (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
    defaults?: {
      fallbackProjectId?: string;
      projectId?: string;
      requirement?: string;
      title?: string;
    },
  ): Promise<AcceptanceItem> => {
    const taskId =
      subjectType === 'topic' ? await resolveRunTopicTaskId(this.deps, subjectId) : undefined;
    if (taskId) return this.ensureForSubject('task', taskId, defaults);
    return this.ensureForSubject(subjectType, subjectId, defaults);
  };

  /**
   * Chain a run onto an acceptance as its next round, then re-derive the
   * aggregate status (a new round re-opens a rejected loop).
   */
  attachRun = async (runId: string, acceptanceId: string): Promise<AttachedRun> => {
    const acceptance = await this.acceptanceModel.findById(acceptanceId);
    if (!acceptance) throw new Error(`Acceptance "${acceptanceId}" not found`);

    return this.attachResolvedRun(runId, acceptance);
  };

  /** Attach a Task run using policy scope while preserving report visibility. */
  attachPolicyRun = async (runId: string, acceptanceId: string): Promise<AttachedRun> => {
    const acceptance = await this.acceptanceModel.findPolicyById(acceptanceId);
    if (!acceptance) throw new Error(`Acceptance "${acceptanceId}" not found`);

    return this.attachResolvedRun(runId, acceptance);
  };

  /**
   * File an ungrouped acceptance under the project its subject implies when a
   * round lands. Appending by acceptance id skips `ensureForSubject`, so an
   * aggregate created before its subject carried a project would otherwise
   * stay ungrouped on every re-verification. Best effort: filing never blocks
   * a round.
   */
  private fileUnderSubjectProject = async (acceptance: AcceptanceItem) => {
    try {
      const projectId = await resolveSubjectProjectId(
        this.deps,
        acceptance.subjectType,
        acceptance.subjectId,
      );
      if (projectId) await this.acceptanceModel.fillProject(acceptance.id, projectId);
    } catch (error) {
      log('could not file acceptance %s under its subject project: %O', acceptance.id, error);
    }
  };

  private attachResolvedRun = async (
    runId: string,
    acceptance: AcceptanceItem,
  ): Promise<AttachedRun> => {
    const acceptanceId = acceptance.id;

    // Idempotent for the re-ingest path (the CLI sidecar remembers the run):
    // an already-chained round keeps its index instead of being re-appended.
    const existing = await this.runModel.findById(runId);
    if (!existing) throw new Error(`Verify run "${runId}" not found in the current workspace`);
    // A retried attach (the response of the first one was lost) still reports
    // the warnings the first one did.
    if (existing.acceptanceId === acceptanceId)
      return withUnresolvedSupersedes(this.deps, existing, acceptanceId);
    if (existing.acceptanceId) {
      throw new Error('This verify run already belongs to another acceptance');
    }
    if (acceptance.status === 'accepted' || acceptance.status === 'closed') {
      throw new Error(
        `This acceptance has already been ${acceptance.status} — reopen it before attaching another round`,
      );
    }

    await assertPlanLeavesAcceptedChecksAlone(this.deps, existing, acceptanceId);
    if (!acceptance.projectId) await this.fileUnderSubjectProject(acceptance);

    // A round that is still only planned has nothing to preserve: the incoming
    // run folds into it instead of pushing the ledger to yet another number.
    // Only the newest round counts — `listByAcceptance` is ascending, and an
    // older draft the chain has moved past is an abandoned ledger position.
    const latest = (await this.runModel.listByAcceptance(acceptanceId)).at(-1);
    // Resolved against the chain as it stood before this run joined it.
    const withWarnings = (attached: VerifyRunItem): Promise<AttachedRun> =>
      withUnresolvedSupersedes(this.deps, attached, acceptanceId, existing);
    // A run that already executed cannot fold (`foldIntoRound` refuses any source
    // with results): its verdicts belong to its own round. It is appended after
    // the draft instead — the path a verification driven by the CLI takes, since
    // it writes its results before the Task drive binds the round.
    const draft =
      latest && isDraftVerifyRun(latest) && (await this.resultModel.listByRun(runId)).length === 0
        ? latest
        : undefined;
    if (draft) {
      const folded = await this.runModel.foldIntoRound(runId, draft.id);
      await this.recomputeStatus(acceptanceId);
      log(
        'run %s folded into draft round %d of acceptance %s',
        runId,
        folded.roundIndex,
        acceptanceId,
      );
      return await withWarnings(folded);
    }

    // Rounds inherit the aggregate's visibility so a private acceptance's new
    // round never leaks through its own report URL.
    const run = await this.runModel.attachToAcceptance(runId, acceptanceId, acceptance.visibility);
    notifyAcceptance(acceptanceId, 'session');
    await this.recomputeStatus(acceptanceId);
    log('run %s attached to acceptance %s as round %d', runId, acceptanceId, run.roundIndex);

    // A new round landing is the first server-side proof that the reviewer is done with the
    // previous one: rejecting a check ends at a clipboard copy, so nothing else marks "I finished
    // reviewing".
    if (latest) this.distilSettledRound(acceptanceId, latest.id);

    return await withWarnings(run);
  };

  /**
   * Fold one acceptance into another — the source's checks (with their rounds,
   * verdicts and evidence) become part of the target's inventory, and the
   * source entry goes away.
   *
   * The two aggregates are the same delivery arriving twice: a second CLI
   * ingest that minted a new standalone acceptance, or a topic and the task it
   * was promoted into. Merging is what makes them one review surface again.
   */
  merge = async (sourceId: string, targetId: string): Promise<AcceptanceMergeSummary> => {
    if (sourceId === targetId) throw new Error('An acceptance cannot be merged into itself');

    const source = await this.acceptanceModel.findById(sourceId);
    if (!source) throw new Error(`Acceptance "${sourceId}" not found`);
    const target = await this.acceptanceModel.findById(targetId);
    if (!target) throw new Error(`Acceptance "${targetId}" not found`);

    // Same rule as attaching a single round: a settled aggregate must be
    // re-opened deliberately before more checks land in it, or an `accepted`
    // sign-off would silently start covering checks nobody signed off on.
    if (target.status === 'accepted' || target.status === 'closed') {
      throw new Error(
        `This acceptance has already been ${target.status} — reopen it before merging into it`,
      );
    }

    const summary = await mergeAcceptanceRounds({
      db: this.db,
      source,
      target,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    // Past this point the merge is COMMITTED and the source no longer exists —
    // so a failure here must not be reported as a failed merge. The caller
    // would surface a retry that can only ever fail ("Acceptance not found"),
    // for a rollup that is derived and re-derived by every later round,
    // decision and sweep. Log it and return the merge that did happen.
    try {
      await this.recomputeStatus(targetId);
    } catch (error) {
      log('acceptance %s merged, but status recompute failed (non-fatal): %O', targetId, error);
    }

    return summary;
  };

  /**
   * Re-derive the aggregate's lifecycle state from its current round. The
   * user's `accepted` / `closed` are terminal; `rejected` is sticky until a
   * round newer than the decision arrives.
   */
  recomputeStatus = async (acceptanceId: string): Promise<AcceptanceStatus | null> => {
    const acceptance = await this.acceptanceModel.findPolicyById(acceptanceId);
    if (!acceptance) return null;
    if (acceptance.status === 'accepted' || acceptance.status === 'closed') {
      return acceptance.status;
    }

    const runs = await this.runModel.listByAcceptance(acceptanceId);
    const current = runs.at(-1);
    if (!current) return acceptance.status as AcceptanceStatus;

    // The rejected round stays rejected; only a NEWER round re-opens the loop.
    if (acceptance.status === 'rejected' && current.userDecision === 'reject') return 'rejected';

    const report = await this.reportModel.findByRun(current.id);
    const status = statusFromRound(current, Boolean(report));
    if (status !== acceptance.status) {
      await this.acceptanceModel.updatePolicyStatus(acceptanceId, status);
      notifyAcceptance(acceptanceId, 'session');
      log('acceptance %s → %s (from round %d)', acceptanceId, status, current.roundIndex);
    }

    // Rounds settled outside the verifier pipeline — an ingested round (no
    // status, settled by its report) or a completed acceptance flow
    // (`delivered`) — have nothing else to drive the task. Rounds the server
    // verifier runs (`passed` / `failed` / `errored`) are driven once, after
    // any auto-repair, by `driveTaskFromVerify`; completing here would race it.
    //
    // Reconciled on every recompute of a delivered aggregate, not only on the
    // transition: a completion that failed once is retried by the next round,
    // report or flow event instead of leaving the task open for good. An
    // already-completed task is a no-op.
    //
    // The round records the Agent Run that published it. When that run is the
    // task's own (an agent ingesting acceptance for the task it executes), the
    // completion waits for the run to end rather than interrupting it.
    if (
      status === 'delivered' &&
      (!current.status || current.status === 'delivered') &&
      acceptance.subjectType === 'task'
    )
      await this.completeTaskForDelivery(
        acceptanceId,
        acceptance.subjectId,
        current.metadata?.origin?.operationId,
      );
    return status;
  };

  /** Latest round of an aggregate — the row `stampDecision` would write to. */
  latestRound = async (acceptanceId: string) => {
    const runs = await this.runModel.listByAcceptance(acceptanceId);
    return runs.at(-1) ?? null;
  };

  regroupChecks = async (
    acceptanceId: string,
    groups: AcceptanceCheckGroup[],
    expectedVersion: number,
  ) => {
    const acceptance = await this.acceptanceModel.findById(acceptanceId);
    if (!acceptance) throw new Error('Acceptance not found');
    const { results, runs } = await this.loadRounds(acceptanceId);
    const resultsByRun = new Map<string, VerifyCheckResultItem[]>();
    for (const result of results) {
      const bucket = resultsByRun.get(result.verifyRunId!) ?? [];
      bucket.push(result);
      resultsByRun.set(result.verifyRunId!, bucket);
    }
    const checks = buildAcceptanceCheckUnion(
      runs.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
    );
    const known = new Set(checks.map((check) => check.id));
    const assigned = new Set<string>();
    const titles = new Set<string>();
    const normalized = groups.map((group) => {
      const title = group.title.trim();
      if (!title || titles.has(title) || group.checkItemIds.length === 0)
        throw new Error('Check groups need unique, non-empty titles and members');
      titles.add(title);
      for (const id of group.checkItemIds) {
        if (!known.has(id)) throw new Error(`Unknown check item: ${id}`);
        if (assigned.has(id)) throw new Error(`Check assigned to multiple groups: ${id}`);
        assigned.add(id);
      }
      return { ...group, title };
    });
    return this.acceptanceModel.setCheckGroups(acceptanceId, normalized, expectedVersion);
  };

  /**
   * Hands one settled round to distillation, fire-and-forget.
   *
   * Never awaited and never allowed to throw: this rides on the reviewer's own paths, and losing a
   * distillation is a missed lesson, while failing the caller loses their decision. Triggering the
   * same round twice is harmless — a round is distilled under a reflection key, and the second pass
   * finds the run already recorded and returns.
   */
  private distilSettledRound = (acceptanceId: string, verifyRunId: string) => {
    void ExpertiseRejectionWorkflow.trigger({
      acceptanceId,
      userId: this.userId,
      verifyRunId,
      workspaceId: this.workspaceId,
    });
  };

  /**
   * The user accepts the delivery — the terminal business event (P-12). Stamps
   * the decision on the current round, closes the aggregate, and best-effort
   * completes a task subject that verification alone didn't settle.
   */
  accept = async (acceptanceId: string, comment?: string): Promise<AcceptanceItem> => {
    const acceptance = await requireDecidableAcceptance(this.acceptanceModel, acceptanceId);

    const settled = await this.stampDecision(acceptanceId, 'accept', comment);
    await this.acceptanceModel.updateStatus(acceptanceId, 'accepted');
    notifyAcceptance(acceptanceId, 'session', this.actorUserId);

    // A terminal decision settles the current round as surely as a new round landing does — and it
    // is the ONLY thing that settles the last one, which no later round will ever follow. Without
    // this, every acceptance silently loses whatever its final round taught. Accepting the delivery
    // still settles it: a reviewer can accept overall while individual checks were rejected along
    // the way, and those rejections are exactly the material.
    this.distilSettledRound(acceptanceId, settled);

    if (acceptance.subjectType === 'task')
      await completeTaskSubject(this.deps, acceptance.subjectId);

    return (await this.acceptanceModel.findById(acceptanceId))!;
  };

  /**
   * A merged pull request accepts the delivery it was linked to. Merging is
   * the strongest signal a user can give, so unlike {@link accept} this does
   * not wait for the round to settle: any non-accepted status becomes
   * `accepted`, a round still in flight is stamped as decided by the merge,
   * and an acceptance that never had a round is simply closed as accepted.
   * The decision detail records the merge so the acceptance board and the
   * verifier-training pipeline can tell it apart from a human verdict.
   *
   * Idempotent: an already-accepted acceptance is returned unchanged.
   */
  acceptFromScmMerge = async (
    acceptanceId: string,
    changeRequest: NonNullable<VerifyRunDecisionDetail['changeRequest']>,
  ): Promise<AcceptanceItem | null> => {
    const acceptance = await this.acceptanceModel.findById(acceptanceId);
    if (!acceptance) return null;
    if (acceptance.status === 'accepted') return acceptance;

    const runs = await this.runModel.listByAcceptance(acceptanceId);
    const current = runs.at(-1);
    if (current) {
      const detail: VerifyRunDecisionDetail = {
        changeRequest,
        decidedAt: new Date().toISOString(),
        decidedBy: this.actorUserId,
        source: 'scm_merge',
      };
      await this.runModel.setDecision(current.id, 'accept', detail);
    }

    await this.acceptanceModel.updateStatus(acceptanceId, 'accepted');
    notifyAcceptance(acceptanceId, 'session', this.actorUserId);
    if (current) this.distilSettledRound(acceptanceId, current.id);
    if (acceptance.subjectType === 'task')
      await completeTaskSubject(this.deps, acceptance.subjectId);

    log(
      'acceptance %s accepted by merge of %s#%d (was %s)',
      acceptanceId,
      changeRequest.repoFullName,
      changeRequest.number,
      acceptance.status,
    );
    return (await this.acceptanceModel.findById(acceptanceId))!;
  };

  /**
   * The user rejects the delivery. An optional comment is a re-tasking input: it is
   * recorded on the round's decision detail, where the next repair/verify round
   * picks it up. (Spawning the repair run is the caller's job — the
   * `acceptance.reject` procedure sends it back to the origin agent when the
   * rounds name one; see `dispatchAcceptanceRepair`.)
   *
   * A Goal Task is no exception: its next attempt is started by the Goal
   * coordinator on the following tick, which reads the rejected round's
   * decision detail through the prompt builder.
   */
  reject = async (acceptanceId: string, comment?: string): Promise<AcceptanceItem> => {
    const acceptance = await requireDecidableAcceptance(this.acceptanceModel, acceptanceId);

    const settled = await this.stampDecision(acceptanceId, 'reject', comment);
    await this.acceptanceModel.updateStatus(acceptanceId, 'rejected');
    notifyAcceptance(acceptanceId, 'session', this.actorUserId);

    this.distilSettledRound(acceptanceId, settled);

    if (acceptance.subjectType === 'task')
      await reopenRejectedTaskSubject(this.deps, acceptance.subjectId);

    return (await this.acceptanceModel.findById(acceptanceId))!;
  };

  /** Records the user's verdict on one or more union checks — see {@link reviewChecks}. */
  reviewChecks = (...args: WithoutDeps<typeof reviewChecks>) => reviewChecks(this.deps, ...args);

  /** Stamps the decision on the current round and returns it — the round that decision settles. */
  private stampDecision = async (
    acceptanceId: string,
    decision: 'accept' | 'reject',
    comment?: string,
  ): Promise<string> => {
    const runs = await this.runModel.listByAcceptance(acceptanceId);
    const current = runs.at(-1);
    if (!current) throw new Error('This acceptance has no verification round to decide on');

    const detail: VerifyRunDecisionDetail = {
      decidedAt: new Date().toISOString(),
      decidedBy: this.actorUserId,
      ...(comment ? { comment } : {}),
    };
    await this.runModel.setDecision(current.id, decision, detail);

    return current.id;
  };

  /** Completes the task a delivered acceptance settles — see {@link completeTaskForDelivery}. */
  completeTaskForDelivery = (...args: WithoutDeps<typeof completeTaskForDelivery>) =>
    completeTaskForDelivery(this.deps, ...args);

  /** Best-effort subject header info for the bundle (title may be gone). */
  resolveSubject = (...args: WithoutDeps<typeof resolveSubject>) =>
    resolveSubject(this.deps, ...args);

  resolveCanonicalSubjectId = (...args: WithoutDeps<typeof resolveCanonicalSubjectId>) =>
    resolveCanonicalSubjectId(this.deps, ...args);

  private resolveSubjects = (...args: WithoutDeps<typeof resolveSubjects>) =>
    resolveSubjects(this.deps, ...args);

  private resolveProjects = (...args: WithoutDeps<typeof resolveProjects>) =>
    resolveProjects(this.deps, ...args);

  private latestCheckCounts = (...args: WithoutDeps<typeof latestCheckCounts>) =>
    latestCheckCounts(this.deps, ...args);

  /**
   * Recent aggregates with their subject headers — the list-panel payload.
   * Titles resolve in batches by subject type; a deleted
   * subject degrades to a null title instead of dropping the row. Each row also
   * carries the latest round's check count for the panel's at-a-glance line.
   */
  listWithSubjects = async (
    options: AcceptanceListOptions & {
      limit?: number;
      q?: string;
    } = {},
  ) => {
    const { filter = 'all', limit = 50, q } = options;
    const normalizedQuery = q?.trim().toLocaleLowerCase();

    // A title search must span the complete owned set. Subject titles live in
    // their source entities (task/topic/document), so resolve them before
    // applying the result cap instead of searching only the latest page.
    const candidates = await this.acceptanceModel.query({
      limit: normalizedQuery ? undefined : limit,
      projectId: options.projectId,
      scope: options.scope,
      source: options.source,
      statuses: statusesForFilter(filter),
      unbounded: Boolean(normalizedQuery),
    });
    const subjects = await this.resolveSubjectsForList(candidates);
    const matched = normalizedQuery
      ? candidates
          .filter((row) =>
            (subjects.get(row.id)?.title || row.subjectId)
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
          .slice(0, limit)
      : candidates;

    return this.decorateListRows(matched, subjects);
  };

  /**
   * The paged twin of {@link listWithSubjects} — one scroll page of the list
   * panel, newest first.
   *
   * Takes the same filter vocabulary, applied in the QUERY: a page of
   * "in progress" is thirty in-progress rows, not thirty rows of which some
   * happen to be in progress. Search deliberately has no paged form — a title
   * search must span the whole owned set, which is what `listWithSubjects`
   * already does; the panel asks that one when a query is active.
   */
  listPageWithSubjects = async (
    options: AcceptanceListOptions & {
      cursor?: string;
      limit?: number;
    },
  ) => {
    const { items, nextCursor } = await this.acceptanceModel.queryPage({
      cursor: options.cursor,
      limit: options.limit,
      projectId: options.projectId,
      scope: options.scope,
      source: options.source,
      statuses: statusesForFilter(options.filter ?? 'all'),
    });

    return {
      items: await this.decorateListRows(items, await this.resolveSubjectsForList(items)),
      nextCursor,
    };
  };

  private isInOwnScope = (...args: WithoutDeps<typeof isInOwnScope>) =>
    isInOwnScope(this.deps, ...args);

  /**
   * Subject headers for a mixed list. Rows in the caller's own scope go through
   * the scoped models as before. A participated row may belong to any number of
   * other owners, whose task/topic/document the caller's models cannot see —
   * those resolve in ONE unscoped read per subject type, so the cost stays
   * fixed however many owners a page spans. Safe because the list query has
   * already applied the read rule to these rows, and the bundle shows the same
   * title to anyone who can open them.
   */
  private resolveSubjectsForList = async (
    rows: AcceptanceItem[],
  ): Promise<Map<string, AcceptanceSubjectSummary>> => {
    const own = rows.filter(this.isInOwnScope);
    const foreign = rows.filter((row) => !this.isInOwnScope(row));
    const [ownSubjects, foreignSubjects] = await Promise.all([
      own.length > 0 ? this.resolveSubjects(own) : new Map<string, AcceptanceSubjectSummary>(),
      this.resolveForeignSubjects(foreign),
    ]);
    return new Map([...ownSubjects, ...foreignSubjects]);
  };

  private resolveForeignSubjects = (...args: WithoutDeps<typeof resolveForeignSubjects>) =>
    resolveForeignSubjects(this.deps, ...args);

  private decorateListRows = async (
    rows: AcceptanceItem[],
    subjects: Map<string, AcceptanceSubjectSummary>,
  ) => {
    const [checkCounts, projects] = await Promise.all([
      this.latestCheckCounts(rows.map((row) => row.id)),
      // Projects stay in the caller's scope: another owner's project name is
      // theirs, and a row filed under it simply reads as unfiled here.
      this.resolveProjects(rows),
    ]);

    return rows.map((row) => ({
      ...row,
      checkCount: checkCounts.get(row.id) ?? null,
      project: projects.get(row.id) ?? null,
      subject: subjects.get(row.id)!,
    }));
  };

  /** The authoring conversation behind the round chain — see {@link resolveOrigin}. */
  resolveOrigin = (...args: WithoutDeps<typeof resolveOrigin>) => resolveOrigin(this.deps, ...args);

  /** The raw origin a rejected delivery is sent back to — see {@link findRepairOrigin}. */
  findRepairOrigin = (...args: WithoutDeps<typeof findRepairOrigin>) =>
    findRepairOrigin(this.deps, ...args);

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

  /**
   * The union tally of several acceptances at once, counted from the SAME check
   * union each acceptance page renders (`tallyCheckUnion` over
   * `buildAcceptanceCheckUnion`), so a summary row and the list it expands to
   * can never disagree about what a round chain judged.
   *
   * Batched on purpose: a surface that summarises many acceptances runs on a
   * poll, so this is two statements regardless of how many it covers. An
   * acceptance with no round at all is ABSENT from the map — a caller must not
   * read "absent" as "nothing passed".
   */
  getCheckTalliesByAcceptances = async (
    acceptanceIds: string[],
  ): Promise<Map<string, VerifyCheckTally>> => {
    const ids = [...new Set(acceptanceIds.filter(Boolean))];
    const tallies = new Map<string, VerifyCheckTally>();
    if (ids.length === 0) return tallies;

    const runs = await this.runModel.listByAcceptances(ids);
    const results = await this.resultModel.listByRuns(runs.map((run) => run.id));

    const resultsByRun = new Map<string, VerifyCheckResultItem[]>();
    for (const result of results) {
      if (!result.verifyRunId) continue;
      const bucket = resultsByRun.get(result.verifyRunId) ?? [];
      bucket.push(result);
      resultsByRun.set(result.verifyRunId, bucket);
    }

    const runsByAcceptance = new Map<string, VerifyRunItem[]>();
    for (const run of runs) {
      if (!run.acceptanceId) continue;
      const bucket = runsByAcceptance.get(run.acceptanceId) ?? [];
      bucket.push(run);
      runsByAcceptance.set(run.acceptanceId, bucket);
    }

    for (const [acceptanceId, acceptanceRuns] of runsByAcceptance) {
      const checks = buildAcceptanceCheckUnion(
        acceptanceRuns.map((run) => ({ results: resultsByRun.get(run.id) ?? [], run })),
      );
      tallies.set(acceptanceId, tallyCheckUnion(checks));
    }
    return tallies;
  };
}
