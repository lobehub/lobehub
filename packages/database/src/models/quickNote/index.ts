import { DEFAULT_QUICK_NOTE_SETTINGS } from '@lobechat/const';
import type { UserQuickNoteSettings } from '@lobechat/types';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { documents, quickNoteRuns, quickNotes, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import * as comments from './comments';
import { type QuickNoteArgs, type QuickNoteContext, quickNoteOwnershipWhere } from './context';
import * as proposals from './proposals';
import * as resources from './resources';
import * as runs from './runs';
import type { CreateQuickNoteParams } from './types';

export { quickNoteTopicAccessWhere } from './context';
export type * from './types';

/** Default number of notes in one list page. */
export const QUICK_NOTE_LIST_PAGE_SIZE = 50;

/** Position after the last note of a list page: its creation time (ISO) and id. */
export interface QuickNoteListCursor {
  createdAt: string;
  id: string;
}

/**
 * Persists private Quick Notes and claims immutable processing snapshots.
 *
 * Use when:
 * - Saving the existing Quick Note editor without changing its UI contract.
 * - Dispatching Analyze against a stable source revision.
 *
 * Expects:
 * - `userId` identifies the owner of every read and mutation.
 * - `workspaceId` is omitted in personal mode and fixed for the model lifetime.
 *
 * Returns:
 * - Owner-scoped Quick Note records and immutable Run identities.
 */
export class QuickNoteModel {
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly db: LobeChatDatabase;

  private readonly ctx: QuickNoteContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.ctx = { db, userId, workspaceId };
  }

  /**
   * Resolves the effective Quick Note Analyze configuration for one user.
   *
   * Use when:
   * - Claiming or dispatching background Quick Note work.
   * - Resolving the Agent binding and immutable execution limits for a new Run.
   *
   * Expects:
   * - Missing fields fall back independently to {@link DEFAULT_QUICK_NOTE_SETTINGS}.
   * - Earlier `general.enableQuickNoteAutomaticDiscovery` values remain readable during rollout.
   *
   * Returns:
   * - A complete, bounded configuration suitable for scheduling and execution.
   */
  static getAnalyzeSettings = async (
    db: LobeChatDatabase,
    userId: string,
  ): Promise<UserQuickNoteSettings> => {
    const [settings] = await db
      .select({ general: userSettings.general, quickNote: userSettings.quickNote })
      .from(userSettings)
      .where(eq(userSettings.id, userId));
    const general = settings?.general as Record<string, unknown> | null | undefined;
    const stored = settings?.quickNote;
    const legacyEnabled = general?.enableQuickNoteAutomaticDiscovery;

    return {
      analyzeAgentId: stored?.analyzeAgentId ?? DEFAULT_QUICK_NOTE_SETTINGS.analyzeAgentId,
      autoAnalyze: {
        enabled:
          stored?.autoAnalyze?.enabled ??
          (typeof legacyEnabled === 'boolean'
            ? legacyEnabled
            : DEFAULT_QUICK_NOTE_SETTINGS.autoAnalyze.enabled),
        idleDelayMs: Math.min(
          300_000,
          Math.max(
            1000,
            stored?.autoAnalyze?.idleDelayMs ?? DEFAULT_QUICK_NOTE_SETTINGS.autoAnalyze.idleDelayMs,
          ),
        ),
      },
      maxAnalyzeSteps: Math.min(
        20,
        Math.max(1, stored?.maxAnalyzeSteps ?? DEFAULT_QUICK_NOTE_SETTINGS.maxAnalyzeSteps),
      ),
    };
  };

  /**
   * Resolves whether automatic Analyze may be scheduled for one user.
   *
   * Use when:
   * - A client edit or server sweep is about to schedule Analyze.
   *
   * Expects:
   * - Missing settings resolve through {@link DEFAULT_QUICK_NOTE_SETTINGS}.
   *
   * Returns:
   * - The effective automatic Analyze toggle.
   */
  static isAutomaticAnalyzeEnabled = async (db: LobeChatDatabase, userId: string) => {
    const settings = await QuickNoteModel.getAnalyzeSettings(db, userId);

    return settings.autoAnalyze.enabled;
  };

  /**
   * Finds due captures whose owners did not explicitly disable Automatic Analyze.
   *
   * Use when:
   * - The one-minute server sweep compensates for closed or disconnected clients.
   *
   * Expects:
   * - `limit` bounds one page and defaults to 100; `after` advances the due-time/id cursor.
   * - Missing user settings mean enabled.
   *
   * Returns:
   * - Owner/workspace routing identities ordered by due time, then ID for stable paging.
   */
  static findDueAnalyzeCandidates = async (
    db: LobeChatDatabase,
    params: {
      /** Resume after a previously scanned due-time/id pair. */
      after?: { analyzeDueAt: Date; id: string };
      /** Maximum rows in one page. @default 100 */
      limit?: number;
      /** Stable due-time cutoff across pages. @default new Date() */
      now?: Date;
    } = {},
  ) =>
    db
      .select({
        analyzeDueAt: quickNotes.analyzeDueAt,
        id: quickNotes.id,
        userId: quickNotes.userId,
        workspaceId: quickNotes.workspaceId,
      })
      .from(quickNotes)
      .leftJoin(userSettings, eq(userSettings.id, quickNotes.userId))
      .where(
        and(
          lte(quickNotes.analyzeDueAt, params.now ?? new Date()),
          params.after &&
            or(
              gt(quickNotes.analyzeDueAt, params.after.analyzeDueAt),
              and(
                eq(quickNotes.analyzeDueAt, params.after.analyzeDueAt),
                gt(quickNotes.id, params.after.id),
              ),
            ),
          sql`COALESCE((${userSettings.quickNote} -> 'autoAnalyze' ->> 'enabled')::boolean, (${userSettings.general} ->> 'enableQuickNoteAutomaticDiscovery')::boolean, true)`,
        ),
      )
      .orderBy(quickNotes.analyzeDueAt, quickNotes.id)
      .limit(params.limit ?? 100);

  /**
   * Finds notes whose debounced meaning-change check is due.
   *
   * Use when:
   * - The one-minute server sweep runs the checks for edits that have gone quiet.
   *
   * Expects:
   * - `limit` bounds one page and defaults to 100; `after` advances the due-time/id cursor.
   * - No settings filter: the check protects pending Proposals whether or not Auto Analyze is on.
   *
   * Returns:
   * - Owner/workspace routing identities ordered by due time, then ID for stable paging.
   */
  static findDueContentCheckCandidates = async (
    db: LobeChatDatabase,
    params: {
      /** Resume after a previously scanned due-time/id pair. */
      after?: { contentCheckDueAt: Date; id: string };
      /** Maximum rows in one page. @default 100 */
      limit?: number;
      /** Stable due-time cutoff across pages. @default new Date() */
      now?: Date;
    } = {},
  ) =>
    db
      .select({
        contentCheckDueAt: quickNotes.contentCheckDueAt,
        id: quickNotes.id,
        userId: quickNotes.userId,
        workspaceId: quickNotes.workspaceId,
      })
      .from(quickNotes)
      .where(
        and(
          lte(quickNotes.contentCheckDueAt, params.now ?? new Date()),
          params.after &&
            or(
              gt(quickNotes.contentCheckDueAt, params.after.contentCheckDueAt),
              and(
                eq(quickNotes.contentCheckDueAt, params.after.contentCheckDueAt),
                gt(quickNotes.id, params.after.id),
              ),
            ),
        ),
      )
      .orderBy(quickNotes.contentCheckDueAt, quickNotes.id)
      .limit(params.limit ?? 100);

  /**
   * Takes a due meaning-change check by clearing its due time.
   *
   * Use when:
   * - The sweep is about to run the check for a candidate.
   *
   * Expects:
   * - Only a time that is still due is cleared. An edit after the candidate scan pushed the time
   *   back, so the claim fails and that later time runs the check instead (last edit wins).
   *
   * Returns:
   * - `true` when this caller owns the check.
   */
  static claimContentCheck = async (db: LobeChatDatabase, id: string, now: Date) => {
    const claimed = await db
      .update(quickNotes)
      .set({ contentCheckDueAt: null })
      .where(and(eq(quickNotes.id, id), lte(quickNotes.contentCheckDueAt, now)))
      .returning({ id: quickNotes.id });

    return claimed.length > 0;
  };

  /**
   * Gives back a claimed meaning-change check whose follow-up work failed.
   *
   * Use when:
   * - The sweep claimed a check with {@link QuickNoteModel.claimContentCheck} but could not enqueue it.
   *
   * Expects:
   * - `dueAt` is the due time the claim cleared. A newer edit that set a later time keeps it.
   *
   * Returns:
   * - `true` when the check was re-armed.
   */
  static releaseContentCheck = async (db: LobeChatDatabase, id: string, dueAt: Date) => {
    const released = await db
      .update(quickNotes)
      .set({ contentCheckDueAt: dueAt })
      .where(and(eq(quickNotes.id, id), isNull(quickNotes.contentCheckDueAt)))
      .returning({ id: quickNotes.id });

    return released.length > 0;
  };

  /**
   * Drops the due Analyze and meaning-change check times of a user's notes.
   *
   * Use when:
   * - The sweep finds a due note whose owner does not have Quick Note enabled. Without this, every
   *   one-minute sweep rescans that user's due rows ahead of enabled users' notes.
   *
   * Expects:
   * - Only times already due at `now` are cleared; a later time stays and is handled when due.
   * - The user's next real edit schedules work again.
   *
   * Returns:
   * - How many notes had due work dropped.
   */
  static retireDueWork = async (db: LobeChatDatabase, userId: string, now: Date) => {
    const retired = await db
      .update(quickNotes)
      .set({
        analyzeDueAt: sql`CASE WHEN ${quickNotes.analyzeDueAt} <= ${now} THEN NULL ELSE ${quickNotes.analyzeDueAt} END`,
        contentCheckDueAt: sql`CASE WHEN ${quickNotes.contentCheckDueAt} <= ${now} THEN NULL ELSE ${quickNotes.contentCheckDueAt} END`,
      })
      .where(
        and(
          eq(quickNotes.userId, userId),
          or(lte(quickNotes.analyzeDueAt, now), lte(quickNotes.contentCheckDueAt, now)),
        ),
      )
      .returning({ id: quickNotes.id });

    return retired.length;
  };

  /**
   * Inserts the Quick Note row for an already-created backing Document.
   *
   * Use when:
   * - `QuickNoteRepository.create` has inserted the private Document in the same transaction.
   *
   * Returns:
   * - The persisted Quick Note.
   */
  createRecord = async (
    params: Omit<CreateQuickNoteParams, 'content' | 'editorData' | 'resources'> & {
      documentId: string;
      id: string;
    },
  ) => {
    const [quickNote] = await this.db
      .insert(quickNotes)
      .values({
        analyzeDueAt: params.analyzeDueAt,
        collection: params.collection,
        documentId: params.documentId,
        id: params.id,
        location: params.location,
        tags: params.tags ?? [],
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning();

    return quickNote;
  };

  /**
   * Lists captures owned by the current user in the current workspace scope.
   *
   * Use when:
   * - Hydrating the Quick Note editor or capture selector.
   *
   * Expects:
   * - No caller-provided ownership filters; the model always applies them.
   *
   * Returns:
   * - Newest-updated Quick Notes first.
   */
  query = async () =>
    this.db
      .select()
      .from(quickNotes)
      .where(this.ownershipWhere())
      .orderBy(desc(quickNotes.updatedAt));

  /**
   * Appends user feedback to a Quick Note.
   *
   * Use when:
   * - A user adds context or correction for later Quick Note Runs.
   *
   * Expects:
   * - The parent Quick Note belongs to the model's owner/workspace scope.
   *
   * Returns:
   * - The new Comment, or `undefined` when the Quick Note is inaccessible.
   */
  createComment = (...args: QuickNoteArgs<typeof comments.createComment>) =>
    comments.createComment(this.ctx, ...args);

  /**
   * Lists the current Comment projections for one owned Quick Note.
   *
   * Use when:
   * - Rendering or collecting the user-to-agent feedback stream.
   *
   * Returns:
   * - Comments ordered by creation time.
   */
  queryComments = (...args: QuickNoteArgs<typeof comments.queryComments>) =>
    comments.queryComments(this.ctx, ...args);

  /**
   * Overwrites a Comment's content.
   *
   * Use when:
   * - A user corrects context previously supplied to processing Agents.
   *
   * Expects:
   * - Earlier Runs keep the text they saw in their own input snapshot.
   *
   * Returns:
   * - The updated Comment, or `undefined` when inaccessible.
   */
  updateComment = (...args: QuickNoteArgs<typeof comments.updateComment>) =>
    comments.updateComment(this.ctx, ...args);

  /**
   * Lists suggested downstream actions with their current and original payloads.
   *
   * Use when:
   * - Presenting Agent-generated actions without executing them.
   *
   * Expects:
   * - Decision state and source validity remain separate dimensions.
   *
   * Returns:
   * - Newest Proposals first.
   */
  queryProposals = (...args: QuickNoteArgs<typeof proposals.queryProposals>) =>
    proposals.queryProposals(this.ctx, ...args);

  /**
   * Lists current typed Context Resources for one owned Quick Note.
   *
   * Use when:
   * - Rendering resources linked by Analyze or the user beside the source note.
   *
   * Expects:
   * - Run-linked context from earlier source revisions remains stored but is not returned;
   *   user-supplied links are always returned.
   *
   * Returns:
   * - Current Context links with the best available product-native display label.
   */
  queryResources = (...args: QuickNoteArgs<typeof resources.queryResources>) =>
    resources.queryResources(this.ctx, ...args);

  /**
   * Reads all Agent-owned sidecar data for one Quick Note detail surface.
   *
   * Use when:
   * - Hydrating summary-adjacent Resources, Proposals, and feedback together.
   *
   * Expects:
   * - Every child query applies the same owner/workspace boundary.
   *
   * Returns:
   * - Independent lists that can be refreshed with one client request.
   */
  queryAgenticDetails = async (quickNoteId: string) => {
    const [comments, proposals, resources] = await Promise.all([
      this.queryComments(quickNoteId),
      this.queryProposals(quickNoteId),
      this.queryResources(quickNoteId),
    ]);

    return { comments, proposals, resources };
  };

  /**
   * Reads one capture with its mutable backing Document projection.
   *
   * Use when:
   * - Hydrating the editor or preparing a Run prompt.
   *
   * Expects:
   * - `id` may refer only to the current owner's workspace scope.
   *
   * Returns:
   * - The capture plus Document content/editor data, or `undefined`.
   */
  findWithContent = async (id: string) => {
    const [result] = await this.db
      .select({
        collection: quickNotes.collection,
        content: documents.content,
        createdAt: quickNotes.createdAt,
        analyzeDueAt: quickNotes.analyzeDueAt,
        documentId: quickNotes.documentId,
        editorData: documents.editorData,
        id: quickNotes.id,
        location: quickNotes.location,
        tags: quickNotes.tags,
        updatedAt: quickNotes.updatedAt,
        userId: quickNotes.userId,
        workspaceId: quickNotes.workspaceId,
      })
      .from(quickNotes)
      .innerJoin(documents, eq(documents.id, quickNotes.documentId))
      .where(and(eq(quickNotes.id, id), this.ownershipWhere()));

    return result;
  };

  /**
   * Lists one page of captures with editor projections, their latest summary, and their latest Run.
   *
   * Use when:
   * - Hydrating the Quick Note list and Home feed, one page at a time.
   *
   * Expects:
   * - `cursor` is the `nextCursor` of the previous page; omit it for the first page.
   * - Run selection is owner-scoped through the parent Quick Note.
   *
   * Returns:
   * - Newest captures first (by creation, so editing a note never moves it between pages), and the
   *   cursor of the next page, or `null` on the last page. `summary` is omitted until a Run
   *   completes with one.
   */
  queryDetails = async ({
    cursor,
    limit = QUICK_NOTE_LIST_PAGE_SIZE,
  }: { cursor?: QuickNoteListCursor | null; limit?: number } = {}) => {
    // Compare and order at millisecond precision: the cursor round-trips through a JS Date, so a
    // microsecond comparison would skip notes created within the same millisecond.
    const createdAtMs = sql<Date>`date_trunc('milliseconds', ${quickNotes.createdAt})`;
    const rows = await this.queryNoteRows(
      and(
        this.ownershipWhere(),
        cursor
          ? or(
              sql`${createdAtMs} < ${new Date(cursor.createdAt).toISOString()}::timestamptz`,
              and(
                sql`${createdAtMs} = ${new Date(cursor.createdAt).toISOString()}::timestamptz`,
                sql`${quickNotes.id} < ${cursor.id}`,
              ),
            )
          : undefined,
      ),
    )
      .orderBy(desc(createdAtMs), desc(quickNotes.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor: QuickNoteListCursor | null =
      rows.length > limit && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null;

    return { items: await this.withRunProjection(page), nextCursor };
  };

  /**
   * Reads one capture with the same projection as a list item.
   *
   * Use when:
   * - Observing one note's active Run, or opening a note that is not in the loaded list pages.
   *
   * Returns:
   * - The list item, or `undefined` when the note is not accessible in this scope.
   */
  queryDetail = async (id: string) => {
    const rows = await this.queryNoteRows(and(eq(quickNotes.id, id), this.ownershipWhere()));
    const [detail] = await this.withRunProjection(rows);
    return detail;
  };

  private queryNoteRows = (where: ReturnType<typeof and>) =>
    this.db
      .select({
        analyzeDueAt: quickNotes.analyzeDueAt,
        collection: quickNotes.collection,
        content: documents.content,
        createdAt: quickNotes.createdAt,
        documentId: quickNotes.documentId,
        editorData: documents.editorData,
        id: quickNotes.id,
        location: quickNotes.location,
        tags: quickNotes.tags,
        updatedAt: quickNotes.updatedAt,
      })
      .from(quickNotes)
      .innerJoin(documents, eq(documents.id, quickNotes.documentId))
      .where(where)
      .$dynamic();

  /**
   * Attaches each note's latest summary and its latest (active first) Run.
   *
   * Both lookups pick one row per note in SQL (`DISTINCT ON`), so a note with a long Run history
   * costs one row, not its whole history.
   */
  private withRunProjection = async <T extends { id: string }>(notes: T[]) => {
    if (notes.length === 0) return [];
    const noteIds = notes.map(({ id }) => id);
    const isActive = sql<boolean>`${quickNoteRuns.status} in ('pending', 'running')`;

    const [summaries, runs] = await Promise.all([
      this.db
        .selectDistinctOn([quickNoteRuns.quickNoteId], {
          completedAt: quickNoteRuns.completedAt,
          content: quickNoteRuns.summary,
          quickNoteId: quickNoteRuns.quickNoteId,
        })
        .from(quickNoteRuns)
        .where(
          and(
            inArray(quickNoteRuns.quickNoteId, noteIds),
            eq(quickNoteRuns.status, 'completed'),
            isNotNull(quickNoteRuns.summary),
            ne(quickNoteRuns.summary, ''),
          ),
        )
        .orderBy(
          quickNoteRuns.quickNoteId,
          desc(quickNoteRuns.completedAt),
          desc(quickNoteRuns.id),
        ),
      this.db
        .selectDistinctOn([quickNoteRuns.quickNoteId], {
          agentId: quickNoteRuns.agentId,
          completedAt: quickNoteRuns.completedAt,
          decision: quickNoteRuns.decision,
          executionConfig: quickNoteRuns.executionConfig,
          id: quickNoteRuns.id,
          kind: quickNoteRuns.kind,
          operationId: quickNoteRuns.operationId,
          quickNoteId: quickNoteRuns.quickNoteId,
          status: quickNoteRuns.status,
          topicId: quickNoteRuns.topicId,
          trigger: quickNoteRuns.trigger,
          updatedAt: quickNoteRuns.updatedAt,
        })
        .from(quickNoteRuns)
        .where(inArray(quickNoteRuns.quickNoteId, noteIds))
        // The most recently updated active Run, else the most recently updated Run.
        .orderBy(
          quickNoteRuns.quickNoteId,
          desc(isActive),
          desc(quickNoteRuns.updatedAt),
          desc(quickNoteRuns.id),
        ),
    ]);

    const latestSummaries = new Map(
      summaries.map((summary) => [
        summary.quickNoteId,
        { completedAt: summary.completedAt ?? new Date(0), content: summary.content! },
      ]),
    );
    const latestRuns = new Map(runs.map((run) => [run.quickNoteId, run]));

    return notes.map((note) => ({
      ...note,
      run: latestRuns.get(note.id),
      summary: latestSummaries.get(note.id),
    }));
  };

  /**
   * Stamps a source save on the Quick Note row.
   *
   * Use when:
   * - `QuickNoteRepository.updateContent` has written the backing Document in the same transaction.
   *
   * Expects:
   * - `id` was already resolved inside the owner scope.
   *
   * Returns:
   * - The updated Quick Note.
   */
  recordContentSave = async (
    id: string,
    params: { analyzeDueAt?: Date | null; contentCheckDueAt?: Date | null; updatedAt: Date },
  ) => {
    const [updated] = await this.db
      .update(quickNotes)
      .set({
        ...(params.analyzeDueAt === undefined ? {} : { analyzeDueAt: params.analyzeDueAt }),
        ...(params.contentCheckDueAt === undefined
          ? {}
          : { contentCheckDueAt: params.contentCheckDueAt }),
        updatedAt: params.updatedAt,
      })
      .where(and(eq(quickNotes.id, id), this.ownershipWhere()))
      .returning();

    return updated;
  };

  /**
   * Marks current pending Proposals stale after the source changed.
   *
   * Use when:
   * - A source save changed content or rich text; decisions stay untouched.
   */
  markPendingProposalsStale = (
    ...args: QuickNoteArgs<typeof proposals.markPendingProposalsStale>
  ) => proposals.markPendingProposalsStale(this.ctx, ...args);

  /**
   * Reads the pending or running Run of one kind for a Quick Note.
   *
   * Use when:
   * - Claiming deduplicates against an active Run before pinning a new snapshot.
   *
   * Returns:
   * - The active Run, or `undefined`.
   */
  findActiveRun = (...args: QuickNoteArgs<typeof runs.findActiveRun>) =>
    runs.findActiveRun(this.ctx, ...args);

  /** Reads the newest completed Run of one kind, the baseline of a meaning-change check. */
  findLatestCompletedRun = (...args: QuickNoteArgs<typeof runs.findLatestCompletedRun>) =>
    runs.findLatestCompletedRun(this.ctx, ...args);

  /**
   * Reads the Comments and pending Proposals recorded in a new Run's input snapshot.
   */
  collectRunInputs = (...args: QuickNoteArgs<typeof runs.collectRunInputs>) =>
    runs.collectRunInputs(this.ctx, ...args);

  /**
   * Inserts a pending Run for a pinned source snapshot and its rendered input snapshot.
   *
   * Use when:
   * - `QuickNoteRepository.claimRun` has written the system Document History snapshot.
   *
   * Returns:
   * - The new Run, or `undefined` when a concurrent claimant won the active-Run index.
   */
  insertPendingRun = (...args: QuickNoteArgs<typeof runs.insertPendingRun>) =>
    runs.insertPendingRun(this.ctx, ...args);

  /**
   * Reads an owned Run with the snapshots completion compares.
   *
   * Returns:
   * - The Run snapshot, or `undefined` when inaccessible.
   */
  findRunForCompletion = (...args: QuickNoteArgs<typeof runs.findRunForCompletion>) =>
    runs.findRunForCompletion(this.ctx, ...args);

  /**
   * Completes a Run with its summary and decision, refreshing tags when its source is current.
   */
  completeRun = (...args: QuickNoteArgs<typeof runs.completeRun>) =>
    runs.completeRun(this.ctx, ...args);

  /**
   * Persists one inert Proposal produced by a Run.
   *
   * Returns:
   * - The pending, current Proposal whose original payload equals its payload.
   */
  createProposal = (...args: QuickNoteArgs<typeof proposals.createProposal>) =>
    proposals.createProposal(this.ctx, ...args);

  /**
   * Overwrites the payload of a still-pending Proposal.
   *
   * Use when:
   * - A user refines an Agent suggestion before deciding what to do with it.
   *
   * Returns:
   * - The updated Proposal, or `undefined` when inaccessible or already decided.
   */
  updateProposalPayload = (...args: QuickNoteArgs<typeof proposals.updateProposalPayload>) =>
    proposals.updateProposalPayload(this.ctx, ...args);

  /**
   * Marks every pending Proposal of older Runs as superseded, stale or not.
   *
   * Use when:
   * - A newer judgement of the current source completed for the same Quick Note.
   */
  supersedeEarlierProposals = (
    ...args: QuickNoteArgs<typeof proposals.supersedeEarlierProposals>
  ) => proposals.supersedeEarlierProposals(this.ctx, ...args);

  /**
   * Locks an owned, pending Proposal row for an executor applying it.
   *
   * Returns:
   * - The locked Proposal, or `undefined` when inaccessible or already decided.
   */
  lockPendingProposal = (...args: QuickNoteArgs<typeof proposals.lockPendingProposal>) =>
    proposals.lockPendingProposal(this.ctx, ...args);

  /**
   * Records a user's Proposal decision without treating source validity as feedback.
   *
   * Use when:
   * - A user dismisses (optionally with a reason) or accepts a suggestion.
   *
   * Expects:
   * - Only pending Proposals can receive their first terminal decision.
   *
   * Returns:
   * - The decided Proposal with `decided_at` set.
   */
  decideProposal = (...args: QuickNoteArgs<typeof proposals.decideProposal>) =>
    proposals.decideProposal(this.ctx, ...args);

  /**
   * Accepts a Proposal and records the product object its executor produced; idempotent.
   *
   * Returns:
   * - The accepted Proposal, including when it was already applied earlier.
   */
  markProposalApplied = (...args: QuickNoteArgs<typeof proposals.markProposalApplied>) =>
    proposals.markProposalApplied(this.ctx, ...args);

  /**
   * Links an accessible typed product resource as context found by a Run.
   *
   * Use when:
   * - A Context Provider candidate is judged clearly relevant by Analyze.
   *
   * Expects:
   * - V1 runtime linking accepts scoped `document`, `page`, `topic` and `conversation` references.
   * - Other resource families remain representable in storage for later native providers.
   *
   * Returns:
   * - The resource link carrying `run_id`, or `undefined` when either side is inaccessible.
   */
  linkResource = (...args: QuickNoteArgs<typeof resources.linkResource>) =>
    resources.linkResource(this.ctx, ...args);

  /**
   * Links user-supplied resources without a Run, skipping inaccessible references.
   *
   * Use when:
   * - A capture is created from another surface and carries the objects it was sent from.
   */
  linkUserResources = (...args: QuickNoteArgs<typeof resources.linkUserResources>) =>
    resources.linkUserResources(this.ctx, ...args);

  /**
   * Links an accessible existing Document through the typed Resource Link path.
   *
   * Returns:
   * - The stable Document resource binding when accessible.
   */
  linkDocumentResource = (...args: QuickNoteArgs<typeof resources.linkDocumentResource>) =>
    resources.linkDocumentResource(this.ctx, ...args);

  /**
   * Connects an Agent Runtime operation and the Topic it uses to a pending Run.
   *
   * Use when:
   * - Runtime startup succeeds after the domain Run has been claimed.
   *
   * Expects:
   * - `runId` belongs to the current owner and remains pending.
   *
   * Returns:
   * - The running Run, or `undefined` when inaccessible or no longer pending.
   */
  attachOperation = (...args: QuickNoteArgs<typeof runs.attachOperation>) =>
    runs.attachOperation(this.ctx, ...args);

  /**
   * Records the first-step intent judgement on a pending or running Run.
   *
   * Returns:
   * - The updated Run, or `undefined` when inaccessible or already terminal.
   */
  recordRunDecision = (...args: QuickNoteArgs<typeof runs.recordRunDecision>) =>
    runs.recordRunDecision(this.ctx, ...args);

  /**
   * Reads one owned Proposal regardless of its decision.
   *
   * Returns:
   * - The Proposal, or `undefined` when inaccessible.
   */
  findProposal = (...args: QuickNoteArgs<typeof proposals.findProposal>) =>
    proposals.findProposal(this.ctx, ...args);

  /**
   * Marks an owned pending/running Run as failed with a diagnostic summary.
   *
   * Use when:
   * - Runtime startup or terminal execution fails before output is accepted.
   *
   * Expects:
   * - `error` contains no secrets or full trace payloads.
   *
   * Returns:
   * - The failed Run, or `undefined` when inaccessible or already terminal.
   */
  failRun = (...args: QuickNoteArgs<typeof runs.failRun>) => runs.failRun(this.ctx, ...args);

  /**
   * Reads the immutable source and container IDs for one owned Run.
   *
   * Use when:
   * - Building an Agent prompt or recovering Run status after refresh.
   *
   * Expects:
   * - Runtime consumers use the Run's input snapshot, never the mutable Document row.
   *
   * Returns:
   * - Run metadata with its input snapshot, or `undefined`.
   */
  getRunContext = (...args: QuickNoteArgs<typeof runs.getRunContext>) =>
    runs.getRunContext(this.ctx, ...args);

  /**
   * Deletes the owned Quick Note row and reports the private containers generated for it.
   *
   * Use when:
   * - `QuickNoteRepository.delete` removes the capture with its backing Document and Run Topics.
   *
   * Expects:
   * - Linked resources may point at user-owned objects and are never reported.
   *
   * Returns:
   * - The source Document and Run Topic ids, or `undefined` when inaccessible.
   */
  deleteRecord = async (id: string) => {
    const [quickNote] = await this.db
      .select()
      .from(quickNotes)
      .where(and(eq(quickNotes.id, id), this.ownershipWhere()));

    if (!quickNote) return undefined;

    const runTopics = await this.db
      .select({ topicId: quickNoteRuns.topicId })
      .from(quickNoteRuns)
      .where(and(eq(quickNoteRuns.quickNoteId, quickNote.id), isNotNull(quickNoteRuns.topicId)));

    await this.db
      .delete(quickNotes)
      .where(and(eq(quickNotes.id, quickNote.id), this.ownershipWhere()));

    return {
      documentId: quickNote.documentId,
      topicIds: [
        ...new Set(
          runTopics
            .map(({ topicId }) => topicId)
            .filter((topicId): topicId is string => Boolean(topicId)),
        ),
      ],
    };
  };

  private ownershipWhere = () => quickNoteOwnershipWhere(this.ctx);
}
