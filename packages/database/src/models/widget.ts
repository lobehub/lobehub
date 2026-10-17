import type {
  WidgetLevelFilter,
  WidgetManifest,
  WidgetOutput,
  WidgetOutputType,
  WidgetRunError,
  WidgetRunFinalStatus,
  WidgetRuntime,
  WidgetRunTrigger,
  WidgetVersionSource,
  WidgetView,
  WidgetVisibility,
} from '@lobechat/types';
import { WIDGET_RUN_OUTPUT_STATUSES } from '@lobechat/types';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, max, sql } from 'drizzle-orm';

import { sha256Json } from '../repositories/ftsSearchDocument/fingerprint';
import { agents } from '../schemas/agent';
import { projects } from '../schemas/project';
import {
  type WidgetRow,
  type WidgetRunRow,
  widgetRuns,
  widgets,
  widgetVersions,
} from '../schemas/widget';
import type { LobeChatDatabase, Transaction } from '../type';
import {
  assertScopeParents,
  buildDirectLevelWhere,
  buildParentAccessibleToOwnerWhere,
  buildParentVisibilityWhere,
  buildProjectWhere,
  hasPrivateParent,
} from '../utils/scopeLevel';
import { isTrashed, notTrashed, restoreStamp, trashStamp } from '../utils/softDelete';
import { isUuid } from '../utils/uuid';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { TrashModel } from './trash';

export interface CreateWidgetInput {
  agentId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  projectId?: string | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  title: string;
  /** Ignored (forced to 'private') when the attached project or agent is private. */
  visibility?: WidgetVisibility;
}

export interface UpdateWidgetInput {
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  metricId?: string | null;
  /** Recomputed by the service whenever the schedule changes. */
  nextRunAt?: Date | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  title?: string;
  /** 'public' is refused (kept 'private') while the project or agent is private. */
  visibility?: WidgetVisibility;
}

export interface CreateWidgetVersionInput {
  changeNote?: string | null;
  manifest?: WidgetManifest | null;
  outputType: WidgetOutputType;
  parentVersionId?: string | null;
  runtime: WidgetRuntime;
  script: string;
  sourceAgentId?: string | null;
  sourceMessageId?: string | null;
  sourceOperationId?: string | null;
  sourceTopicId?: string | null;
  sourceType: WidgetVersionSource;
  view?: WidgetView | null;
}

export interface PublishWidgetVersionOptions {
  /** First due instant under the widget's schedule, computed by the caller. */
  nextRunAt?: Date | null;
}

export interface StartWidgetRunInput {
  operationId?: string | null;
  trigger: WidgetRunTrigger;
  /** Defaults to the draft (preview) or the published version (manual / schedule). */
  versionId?: string;
}

export interface FinishWidgetRunInput {
  durationMs?: number | null;
  error?: WidgetRunError | null;
  exitCode?: number | null;
  finishedAt?: Date;
  output?: WidgetOutput | null;
  sandboxId?: string | null;
  status: WidgetRunFinalStatus;
  stderr?: string | null;
  stdout?: string | null;
}

/** Content identity of a version: everything that changes what a run does or shows. */
export const computeWidgetContentHash = (input: {
  manifest?: WidgetManifest | null;
  outputType: WidgetOutputType;
  runtime: WidgetRuntime;
  script: string;
  view?: WidgetView | null;
}): string =>
  sha256Json({
    manifest: input.manifest ?? null,
    outputType: input.outputType,
    runtime: input.runtime,
    script: input.script,
    view: input.view ?? null,
  });

/** `succeeded` and `partial` both carry a renderable output. */
const producesOutput = (status: WidgetRunFinalStatus) =>
  (WIDGET_RUN_OUTPUT_STATUSES as readonly WidgetRunFinalStatus[]).includes(status);

/**
 * Widgets, their script versions and run history.
 *
 * Instance methods are ownership-scoped like `ProjectModel`: reads follow
 * `buildWorkspaceWhere` (workspace + visibility, trashed rows hidden), writes
 * (edit, version, publish, trash) are limited to the creator, while any reader
 * may trigger a run. Role-based permissions are enforced in the routers. The
 * static methods at the bottom are the scheduler's cross-user entry points and
 * must only be called from trusted server code.
 */
export class WidgetModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private get ctx() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  /**
   * Visible to the caller: workspace + own visibility (`widgets` is
   * trash-aware, so trashed rows drop out) and the *current* visibility of the
   * attached project / agent. Versions, runs and the metric subject are all
   * reached through this predicate.
   */
  private readable() {
    return and(
      buildWorkspaceWhere(this.ctx, widgets),
      buildParentVisibilityWhere(this.ctx, widgets),
    );
  }

  private manageable() {
    return and(this.readable(), eq(widgets.userId, this.userId));
  }

  /** The caller's own rows, trashed or not — for restore and hard delete. */
  private ownedIncludingTrashed() {
    return and(
      buildWorkspaceWhere({ ...this.ctx, includeTrashed: true }, widgets),
      eq(widgets.userId, this.userId),
    );
  }

  // ── Widgets ──

  async create(input: CreateWidgetInput) {
    const scope = { agentId: input.agentId ?? null, projectId: input.projectId ?? null };
    const parents = await assertScopeParents(this.db, this.ctx, scope);
    const visibility: WidgetVisibility | undefined = hasPrivateParent(parents)
      ? 'private'
      : input.visibility;

    const [widget] = await this.db
      .insert(widgets)
      .values(buildWorkspacePayload(this.ctx, { ...input, ...scope, visibility }))
      .returning();

    return widget;
  }

  async findById(id: string) {
    // uuid column: a malformed id would abort the query with 22P02.
    if (!isUuid(id)) return undefined;

    const [widget] = await this.db
      .select()
      .from(widgets)
      .where(and(eq(widgets.id, id), this.readable()))
      .limit(1);

    return widget;
  }

  /** Widgets living directly on one level, most recently updated first. */
  async list(filter: WidgetLevelFilter = {}) {
    return this.db
      .select()
      .from(widgets)
      .where(and(this.readable(), buildDirectLevelWhere(widgets, filter)))
      .orderBy(desc(widgets.updatedAt));
  }

  /** Every widget of a project, including those an agent of the project also owns. */
  async listByProject(projectId: string) {
    return this.db
      .select()
      .from(widgets)
      .where(and(this.readable(), buildProjectWhere(widgets, projectId)))
      .orderBy(desc(widgets.updatedAt));
  }

  async update(id: string, input: UpdateWidgetInput) {
    const values = { ...input };
    if (values.visibility === 'public' && (await this.hasPrivateParent(id))) {
      values.visibility = 'private';
    }

    const [widget] = await this.db
      .update(widgets)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(widgets.id, id), this.manageable()))
      .returning();

    return widget;
  }

  /**
   * Move a widget to the recycle bin and register it there. Trashed widgets
   * drop out of every read and of the scheduler's due query; versions and runs
   * stay for restore.
   */
  async trash(id: string) {
    if (!isUuid(id)) return undefined;

    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [widget] = await tx
        .update(widgets)
        .set(trashStamp(now))
        .where(and(eq(widgets.id, id), this.manageable()))
        .returning();
      if (!widget) return undefined;

      await this.trashRegistry(tx).register(
        {
          deletedAt: now,
          root: {
            projectId: widget.projectId,
            resourceId: widget.id,
            resourceType: 'widget',
            title: widget.title,
          },
        },
        tx,
      );

      return widget;
    });
  }

  async restore(id: string) {
    if (!isUuid(id)) return undefined;

    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .update(widgets)
        .set(restoreStamp())
        .where(and(eq(widgets.id, id), this.ownedIncludingTrashed(), isTrashed(widgets.isDeleted)))
        .returning();
      if (!widget) return undefined;

      await this.trashRegistry(tx).removeByResources(
        [{ resourceId: widget.id, resourceType: 'widget' }],
        tx,
      );
      return widget;
    });
  }

  /** Hard delete; versions and runs cascade. */
  async delete(id: string) {
    return this.hardDelete(id, false);
  }

  /**
   * Permanently delete a widget the recycle bin still holds. Gated on
   * `is_deleted` so a restore that commits after the purge read the registry
   * keeps the row instead of losing it.
   */
  async purge(id: string) {
    return this.hardDelete(id, true);
  }

  private async hardDelete(id: string, onlyTrashed: boolean) {
    if (!isUuid(id)) return undefined;

    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .delete(widgets)
        .where(
          and(
            eq(widgets.id, id),
            this.ownedIncludingTrashed(),
            onlyTrashed ? isTrashed(widgets.isDeleted) : undefined,
          ),
        )
        .returning();
      if (!widget) return undefined;

      await this.trashRegistry(tx).removeByResources(
        [{ resourceId: widget.id, resourceType: 'widget' }],
        tx,
      );
      return widget;
    });
  }

  /**
   * Replace (or clear) the refresh schedule of a widget the caller manages and
   * close every scheduled run still reserved (`running`) as failed with
   * `SCHEDULE_CHANGED`, in one transaction holding the widget row lock.
   *
   * The lock serializes this against `claimDueRun`, which claims by updating
   * the same row: a claim that committed first has its reservation cancelled
   * here; a claim that arrives after finds `next_run_at` changed and fails its
   * compare-and-set. No reservation from the old schedule survives either way.
   */
  async setSchedule(
    widgetId: string,
    schedule: {
      nextRunAt: Date | null;
      schedulePattern: string | null;
      scheduleTimezone: string | null;
    },
  ) {
    if (!isUuid(widgetId)) return undefined;

    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .select({ id: widgets.id })
        .from(widgets)
        .where(and(eq(widgets.id, widgetId), this.manageable()))
        .limit(1)
        .for('update');
      if (!widget) return undefined;

      await tx
        .update(widgetRuns)
        .set({
          error: {
            code: 'SCHEDULE_CHANGED',
            message: 'The schedule changed before this run finished',
          },
          finishedAt: new Date(),
          status: 'failed',
        })
        .where(
          and(
            eq(widgetRuns.widgetId, widgetId),
            eq(widgetRuns.trigger, 'schedule'),
            eq(widgetRuns.status, 'running'),
          ),
        );

      const [updated] = await tx
        .update(widgets)
        .set({ ...schedule, updatedAt: new Date() })
        .where(eq(widgets.id, widgetId))
        .returning();
      return updated;
    });
  }

  // ── Versions ──

  /**
   * Record a new draft version and make it the widget's current draft. When
   * the content is identical to the current draft, that draft is returned
   * instead of minting a duplicate.
   */
  async createVersion(widgetId: string, input: CreateWidgetVersionInput) {
    if (!isUuid(widgetId)) return undefined;

    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .select()
        .from(widgets)
        .where(and(eq(widgets.id, widgetId), this.manageable()))
        .limit(1)
        .for('update');
      if (!widget) return undefined;

      const contentHash = computeWidgetContentHash(input);

      if (widget.draftVersionId) {
        const [draft] = await tx
          .select()
          .from(widgetVersions)
          .where(eq(widgetVersions.id, widget.draftVersionId))
          .limit(1);
        if (draft?.contentHash === contentHash) return draft;
      }

      const [latest] = await tx
        .select({ version: max(widgetVersions.version) })
        .from(widgetVersions)
        .where(eq(widgetVersions.widgetId, widgetId));

      const [version] = await tx
        .insert(widgetVersions)
        .values({
          ...input,
          contentHash,
          parentVersionId:
            input.parentVersionId ?? widget.draftVersionId ?? widget.publishedVersionId,
          status: 'draft',
          userId: widget.userId,
          version: (latest?.version ?? 0) + 1,
          widgetId,
          workspaceId: widget.workspaceId,
        })
        .returning();

      await tx
        .update(widgets)
        .set({ draftVersionId: version.id, updatedAt: new Date() })
        .where(eq(widgets.id, widgetId));

      return version;
    });
  }

  async listVersions(widgetId: string) {
    const widget = await this.findById(widgetId);
    if (!widget) return [];

    return this.db
      .select()
      .from(widgetVersions)
      .where(eq(widgetVersions.widgetId, widgetId))
      .orderBy(desc(widgetVersions.version));
  }

  async findVersion(widgetId: string, versionId: string) {
    if (!isUuid(versionId)) return undefined;
    const widget = await this.findById(widgetId);
    if (!widget) return undefined;

    const [version] = await this.db
      .select()
      .from(widgetVersions)
      .where(and(eq(widgetVersions.id, versionId), eq(widgetVersions.widgetId, widgetId)))
      .limit(1);

    return version;
  }

  /**
   * Make a version live. The previously published version is archived, the
   * draft pointer is cleared when it is the one being published, and the
   * schedule's first due instant is stored when provided.
   */
  async publishVersion(
    widgetId: string,
    versionId: string,
    options: PublishWidgetVersionOptions = {},
  ) {
    if (!isUuid(widgetId) || !isUuid(versionId)) return undefined;

    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .select()
        .from(widgets)
        .where(and(eq(widgets.id, widgetId), this.manageable()))
        .limit(1)
        .for('update');
      if (!widget) return undefined;

      const now = new Date();
      const [version] = await tx
        .update(widgetVersions)
        .set({ publishedAt: now, publishedByUserId: this.userId, status: 'published' })
        .where(and(eq(widgetVersions.id, versionId), eq(widgetVersions.widgetId, widgetId)))
        .returning();
      if (!version) return undefined;

      if (widget.publishedVersionId && widget.publishedVersionId !== versionId) {
        await tx
          .update(widgetVersions)
          .set({ status: 'archived' })
          .where(eq(widgetVersions.id, widget.publishedVersionId));
      }

      const [updated] = await tx
        .update(widgets)
        .set({
          ...(widget.draftVersionId === versionId && { draftVersionId: null }),
          ...(options.nextRunAt !== undefined && { nextRunAt: options.nextRunAt }),
          publishedVersionId: versionId,
          updatedAt: now,
        })
        .where(eq(widgets.id, widgetId))
        .returning();

      return { version, widget: updated };
    });
  }

  // ── Runs ──

  /** Open a run for a readable widget. Any reader may refresh a widget. */
  async startRun(widgetId: string, input: StartWidgetRunInput) {
    const widget = await this.findById(widgetId);
    if (!widget) return undefined;

    return WidgetModel.startRun(this.db, widget, input);
  }

  async finishRun(runId: string, input: FinishWidgetRunInput) {
    if (!isUuid(runId)) return undefined;

    const [run] = await this.db
      .select({ id: widgetRuns.id })
      .from(widgetRuns)
      .innerJoin(widgets, eq(widgetRuns.widgetId, widgets.id))
      .where(and(eq(widgetRuns.id, runId), this.readable()))
      .limit(1);
    if (!run) return undefined;

    return (await WidgetModel.finishRun(this.db, runId, input))?.run;
  }

  async listRuns(widgetId: string, options: { limit?: number } = {}) {
    const widget = await this.findById(widgetId);
    if (!widget) return [];

    return this.db
      .select()
      .from(widgetRuns)
      .where(eq(widgetRuns.widgetId, widgetId))
      .orderBy(desc(widgetRuns.createdAt))
      .limit(options.limit ?? 20);
  }

  async findRun(widgetId: string, runId: string) {
    if (!isUuid(runId)) return undefined;
    const widget = await this.findById(widgetId);
    if (!widget) return undefined;

    const [run] = await this.db
      .select()
      .from(widgetRuns)
      .where(and(eq(widgetRuns.id, runId), eq(widgetRuns.widgetId, widgetId)))
      .limit(1);

    return run;
  }

  /**
   * The newest usable preview run of one version's content — what a publish
   * approval was shown, however far the run history has rolled on. Unlike
   * {@link listRuns} this is keyed by version, so it keeps answering after
   * the version's runs leave the newest-N window.
   *
   * The lookup matches by content hash, exactly like the publish gate
   * ({@link hasSucceededRunForContentHash}): a draft row that reuses an
   * earlier version's content is tried by that version's successful dry run,
   * so the review must find the same run or a same-content draft would
   * deadlock its own approval.
   */
  async findPreviewRun(widgetId: string, versionId: string) {
    if (!isUuid(versionId)) return undefined;
    const widget = await this.findById(widgetId);
    if (!widget) return undefined;

    const [version] = await this.db
      .select({ contentHash: widgetVersions.contentHash })
      .from(widgetVersions)
      .where(and(eq(widgetVersions.id, versionId), eq(widgetVersions.widgetId, widgetId)))
      .limit(1);
    if (!version) return undefined;

    const [row] = await this.db
      .select({ run: widgetRuns })
      .from(widgetRuns)
      .innerJoin(widgetVersions, eq(widgetRuns.versionId, widgetVersions.id))
      .where(
        and(
          eq(widgetRuns.widgetId, widgetId),
          eq(widgetRuns.trigger, 'preview'),
          inArray(widgetRuns.status, [...WIDGET_RUN_OUTPUT_STATUSES]),
          eq(widgetVersions.contentHash, version.contentHash),
        ),
      )
      .orderBy(desc(widgetRuns.createdAt))
      .limit(1);

    return row?.run;
  }

  /**
   * Whether any version of this widget with the given content hash has a run
   * that produced a usable output (`succeeded` or `partial`). Publishing a
   * draft is gated on this: the exact content going live must have executed
   * and met the output contract at least once, whichever version row carried
   * it.
   */
  async hasSucceededRunForContentHash(widgetId: string, contentHash: string) {
    const widget = await this.findById(widgetId);
    if (!widget) return false;

    const [row] = await this.db
      .select({ id: widgetRuns.id })
      .from(widgetRuns)
      .innerJoin(widgetVersions, eq(widgetRuns.versionId, widgetVersions.id))
      .where(
        and(
          eq(widgetRuns.widgetId, widgetId),
          inArray(widgetRuns.status, [...WIDGET_RUN_OUTPUT_STATUSES]),
          eq(widgetVersions.contentHash, contentHash),
        ),
      )
      .limit(1);

    return !!row;
  }

  private trashRegistry(tx: Transaction) {
    return new TrashModel(tx as unknown as LobeChatDatabase, this.userId, this.workspaceId);
  }

  /** Whether the widget's project or agent is currently private. */
  private async hasPrivateParent(id: string) {
    if (!isUuid(id)) return false;

    const [row] = await this.db
      .select({ agentVisibility: agents.visibility, projectVisibility: projects.visibility })
      .from(widgets)
      .leftJoin(projects, eq(widgets.projectId, projects.id))
      .leftJoin(agents, eq(widgets.agentId, agents.id))
      .where(eq(widgets.id, id))
      .limit(1);

    return row?.projectVisibility === 'private' || row?.agentVisibility === 'private';
  }

  // ── Scheduler (trusted, cross-user) ──

  /** A live widget and its published version, for a queued scheduled run. */
  static async findLiveWithPublishedVersion(db: LobeChatDatabase, widgetId: string) {
    if (!isUuid(widgetId)) return undefined;

    const [row] = await db
      .select({ version: widgetVersions, widget: widgets })
      .from(widgets)
      .innerJoin(widgetVersions, eq(widgets.publishedVersionId, widgetVersions.id))
      .where(
        and(
          eq(widgets.id, widgetId),
          notTrashed(widgets.isDeleted),
          // Same gate as `findDue`: a slot dispatched just before the parent was
          // trashed or made private must not run on the owner's credentials.
          buildParentAccessibleToOwnerWhere(widgets),
        ),
      )
      .limit(1);

    return row;
  }

  /** Point the widget at its trend series once the first point is written. */
  static async linkMetric(
    db: LobeChatDatabase,
    widgetId: string,
    metricId: string,
    /** Only link while this run still owns the snapshot (`last_run_id`). */
    runId: string,
  ) {
    await db
      .update(widgets)
      .set({ metricId })
      .where(and(eq(widgets.id, widgetId), eq(widgets.lastRunId, runId)));
  }

  /**
   * Live, published, scheduled widgets whose `next_run_at` has passed, with
   * the version to execute. Walks `widgets_due_idx`.
   *
   * Skips widgets their owner can no longer reach through the attached
   * project / agent (trashed, or private to someone else). `next_run_at` is
   * left as is, so the schedule resumes once access returns.
   */
  static async findDue(db: LobeChatDatabase, options: { limit?: number; now?: Date } = {}) {
    return db
      .select({ version: widgetVersions, widget: widgets })
      .from(widgets)
      .innerJoin(widgetVersions, eq(widgets.publishedVersionId, widgetVersions.id))
      .where(
        and(
          isNotNull(widgets.nextRunAt),
          isNotNull(widgets.schedulePattern),
          isNotNull(widgets.publishedVersionId),
          notTrashed(widgets.isDeleted),
          lte(widgets.nextRunAt, options.now ?? new Date()),
          buildParentAccessibleToOwnerWhere(widgets),
        ),
      )
      .orderBy(asc(widgets.nextRunAt))
      .limit(options.limit ?? 50);
  }

  /**
   * Claim one due slot and reserve its run in a single transaction: move
   * `next_run_at` forward only if it still holds the value the caller read
   * (compare-and-set), and insert the `schedule` run as `running`. Either both
   * happen or neither, so a claimed slot always leaves a durable run behind
   * that a later worker can resume (see `findStaleScheduledRuns`). Returns
   * undefined when another worker won the slot.
   */
  static async claimDueRun(
    db: LobeChatDatabase,
    params: {
      expectedNextRunAt: Date;
      nextRunAt: Date | null;
      /** The published version read with the due widget. */
      versionId: string;
      widgetId: string;
    },
  ): Promise<WidgetRunRow | undefined> {
    return db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(widgets)
        .set({ nextRunAt: params.nextRunAt })
        .where(
          and(
            eq(widgets.id, params.widgetId),
            eq(widgets.nextRunAt, params.expectedNextRunAt),
            // Re-check what the due read saw: a trash, unpublish/republish or a
            // parent turning inaccessible that commits first makes the claim lose.
            eq(widgets.publishedVersionId, params.versionId),
            notTrashed(widgets.isDeleted),
            buildParentAccessibleToOwnerWhere(widgets),
          ),
        )
        .returning({ userId: widgets.userId, workspaceId: widgets.workspaceId });
      if (!claimed) return undefined;

      const [run] = await tx
        .insert(widgetRuns)
        .values({
          // Millisecond precision on purpose: the lease is compared-and-set
          // against the value a reader got back as a JS Date.
          startedAt: new Date(),
          status: 'running',
          trigger: 'schedule',
          userId: claimed.userId,
          versionId: params.versionId,
          widgetId: params.widgetId,
          workspaceId: claimed.workspaceId,
        })
        .returning();

      return run;
    });
  }

  /**
   * Reserved `schedule` runs still `running` that started before
   * `startedBefore` — candidates whose worker may have died. The caller
   * applies each run's own lease (it depends on the version's timeout) before
   * resuming one through {@link renewRunLease}.
   *
   * Driven from live, scheduled widgets (the `widgets_due_idx` predicate) and
   * their runs created since `createdAfter` (`widget_runs_widget_id_created_at_idx`),
   * so the sweep never scans the whole run history. Widgets that are trashed,
   * unscheduled or no longer reachable by their owner are not resumed.
   */
  static async findStaleScheduledRuns(
    db: LobeChatDatabase,
    options: {
      createdAfter: Date;
      limit: number;
      runId?: string;
      startedBefore: Date;
      widgetId?: string;
    },
  ) {
    if (options.runId !== undefined && !isUuid(options.runId)) return [];
    if (options.widgetId !== undefined && !isUuid(options.widgetId)) return [];

    return db
      .select({ run: widgetRuns, version: widgetVersions, widget: widgets })
      .from(widgets)
      .innerJoin(
        widgetRuns,
        and(eq(widgetRuns.widgetId, widgets.id), gte(widgetRuns.createdAt, options.createdAfter)),
      )
      .innerJoin(widgetVersions, eq(widgetRuns.versionId, widgetVersions.id))
      .where(
        and(
          isNotNull(widgets.nextRunAt),
          isNotNull(widgets.schedulePattern),
          isNotNull(widgets.publishedVersionId),
          notTrashed(widgets.isDeleted),
          buildParentAccessibleToOwnerWhere(widgets),
          eq(widgetRuns.status, 'running'),
          eq(widgetRuns.trigger, 'schedule'),
          lt(widgetRuns.startedAt, options.startedBefore),
          options.widgetId ? eq(widgets.id, options.widgetId) : undefined,
          options.runId ? eq(widgetRuns.id, options.runId) : undefined,
        ),
      )
      .orderBy(asc(widgetRuns.startedAt))
      .limit(options.limit);
  }

  /**
   * Take over a stale running run by restarting its lease: `started_at` moves
   * to now only if the run is still `running` and its `started_at` is still
   * the value the caller judged stale (compare-and-set). Exactly one resumer
   * wins; the others get undefined.
   */
  static async renewRunLease(
    db: LobeChatDatabase,
    params: { expectedStartedAt: Date; runId: string },
  ): Promise<WidgetRunRow | undefined> {
    if (!isUuid(params.runId)) return undefined;

    const [run] = await db
      .update(widgetRuns)
      .set({ startedAt: new Date() })
      .where(
        and(
          eq(widgetRuns.id, params.runId),
          eq(widgetRuns.status, 'running'),
          sql`date_trunc('milliseconds', ${widgetRuns.startedAt}) = ${params.expectedStartedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning();

    return run;
  }

  /** Insert a `running` run owned by the widget's owner and workspace. */
  static async startRun(
    db: LobeChatDatabase,
    widget: Pick<
      WidgetRow,
      'draftVersionId' | 'id' | 'publishedVersionId' | 'userId' | 'workspaceId'
    >,
    input: StartWidgetRunInput,
  ) {
    const versionId =
      input.versionId ??
      (input.trigger === 'preview'
        ? (widget.draftVersionId ?? widget.publishedVersionId)
        : widget.publishedVersionId);
    if (!versionId) throw new Error('Widget has no version to run');
    if (!isUuid(versionId)) throw new Error('Version does not belong to this widget');

    const [version] = await db
      .select({ id: widgetVersions.id })
      .from(widgetVersions)
      .where(and(eq(widgetVersions.id, versionId), eq(widgetVersions.widgetId, widget.id)))
      .limit(1);
    if (!version) throw new Error('Version does not belong to this widget');

    const [run] = await db
      .insert(widgetRuns)
      .values({
        operationId: input.operationId ?? null,
        status: 'running',
        trigger: input.trigger,
        userId: widget.userId,
        versionId,
        widgetId: widget.id,
        workspaceId: widget.workspaceId,
      })
      .returning();

    return run;
  }

  /**
   * Whether a finished non-preview run may update the widget snapshot: it ran
   * the published version and started no earlier than the snapshot's run.
   */
  private static async isCurrentRun(
    tx: Transaction,
    widget: Pick<WidgetRow, 'lastRunId' | 'publishedVersionId'>,
    run: Pick<WidgetRunRow, 'id' | 'startedAt' | 'versionId'>,
  ) {
    if (run.versionId !== widget.publishedVersionId) return false;
    if (!widget.lastRunId || widget.lastRunId === run.id) return true;

    const [last] = await tx
      .select({ startedAt: widgetRuns.startedAt })
      .from(widgetRuns)
      .where(eq(widgetRuns.id, widget.lastRunId))
      .limit(1);

    return !last || run.startedAt.getTime() >= last.startedAt.getTime();
  }

  /**
   * Close a running run and, unless it was a preview, fold the result into
   * the widget snapshot: `succeeded` and `partial` store the output and reset
   * the failure streak; `failed` / `timeout` increment it and keep the last
   * usable output. Finishing an already-finished run is a no-op that returns
   * undefined.
   *
   * Runs finish out of order (a slow manual refresh can report after the next
   * scheduled run, or after a new version went live). The run row is always
   * persisted, but it only folds into the snapshot when it is still current:
   * its version is the widget's published version and it started no earlier
   * than the run that last updated the snapshot (`last_run_id`). The widget
   * row is locked for the decision so concurrent finishers serialize.
   *
   * `folded` reports that decision, so anything else derived from "the
   * widget's current value" (the metric trend) follows the same rule.
   */
  static async finishRun(
    db: LobeChatDatabase,
    runId: string,
    input: FinishWidgetRunInput,
  ): Promise<{ folded: boolean; run: WidgetRunRow } | undefined> {
    return db.transaction(async (tx) => {
      const finishedAt = input.finishedAt ?? new Date();
      const [run] = await tx
        .update(widgetRuns)
        .set({
          durationMs:
            input.durationMs ??
            sql<number>`GREATEST(0, (EXTRACT(EPOCH FROM (${finishedAt.toISOString()}::timestamptz - ${widgetRuns.startedAt})) * 1000)::integer)`,
          error: input.error ?? null,
          exitCode: input.exitCode ?? null,
          finishedAt,
          output: input.output ?? null,
          sandboxId: input.sandboxId ?? null,
          status: input.status,
          stderr: input.stderr ?? null,
          stdout: input.stdout ?? null,
        })
        .where(and(eq(widgetRuns.id, runId), eq(widgetRuns.status, 'running')))
        .returning();
      if (!run) return undefined;

      if (run.trigger === 'preview') return { folded: false, run };

      const [widget] = await tx
        .select({
          lastRunId: widgets.lastRunId,
          publishedVersionId: widgets.publishedVersionId,
        })
        .from(widgets)
        .where(eq(widgets.id, run.widgetId))
        .limit(1)
        .for('update');
      if (!widget || !(await WidgetModel.isCurrentRun(tx, widget, run))) {
        return { folded: false, run };
      }

      const usable = producesOutput(input.status);
      await tx
        .update(widgets)
        .set({
          consecutiveFailures: usable ? 0 : sql`${widgets.consecutiveFailures} + 1`,
          lastRunAt: finishedAt,
          lastRunError: input.error ?? null,
          lastRunId: run.id,
          lastRunStatus: input.status,
          ...(usable && { latestOutput: input.output ?? null, latestOutputAt: finishedAt }),
        })
        .where(eq(widgets.id, run.widgetId));

      return { folded: true, run };
    });
  }
}
