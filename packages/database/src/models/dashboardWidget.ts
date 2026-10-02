import type {
  DashboardLevelFilter,
  DashboardVisibility,
  DashboardWidgetRunError,
  DashboardWidgetRunFinalStatus,
  DashboardWidgetRuntime,
  DashboardWidgetRunTrigger,
  DashboardWidgetVersionSource,
  WidgetManifest,
  WidgetOutput,
  WidgetOutputType,
  WidgetView,
} from '@lobechat/types';
import { and, asc, desc, eq, isNotNull, lte, max, sql } from 'drizzle-orm';

import { sha256Json } from '../repositories/ftsSearchDocument/fingerprint';
import {
  type DashboardWidgetRow,
  dashboardWidgetRuns,
  dashboardWidgets,
  dashboardWidgetVersions,
} from '../schemas/dashboard';
import type { LobeChatDatabase } from '../type';
import {
  assertDashboardScope,
  buildDashboardLevelWhere,
  isNotTrashed,
} from '../utils/dashboardScope';
import {
  registerTrashItem,
  restoreStamp,
  trashStamp,
  unregisterTrashItem,
} from '../utils/trashRegistry';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface CreateDashboardWidgetInput {
  agentId?: string | null;
  description?: string | null;
  projectId?: string | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  title: string;
  visibility?: DashboardVisibility;
}

export interface UpdateDashboardWidgetInput {
  description?: string | null;
  metricId?: string | null;
  /** Recomputed by the service whenever the schedule changes. */
  nextRunAt?: Date | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  title?: string;
  visibility?: DashboardVisibility;
}

export interface CreateDashboardWidgetVersionInput {
  changeNote?: string | null;
  manifest?: WidgetManifest | null;
  outputType: WidgetOutputType;
  parentVersionId?: string | null;
  runtime: DashboardWidgetRuntime;
  script: string;
  sourceAgentId?: string | null;
  sourceMessageId?: string | null;
  sourceOperationId?: string | null;
  sourceTopicId?: string | null;
  sourceType: DashboardWidgetVersionSource;
  view?: WidgetView | null;
}

export interface PublishDashboardWidgetVersionOptions {
  /** First due instant under the widget's schedule, computed by the caller. */
  nextRunAt?: Date | null;
}

export interface StartDashboardWidgetRunInput {
  operationId?: string | null;
  trigger: DashboardWidgetRunTrigger;
  /** Defaults to the draft (preview) or the published version (manual / schedule). */
  versionId?: string;
}

export interface FinishDashboardWidgetRunInput {
  durationMs?: number | null;
  error?: DashboardWidgetRunError | null;
  exitCode?: number | null;
  finishedAt?: Date;
  output?: WidgetOutput | null;
  sandboxId?: string | null;
  status: DashboardWidgetRunFinalStatus;
  stderr?: string | null;
  stdout?: string | null;
}

/** Content identity of a version: everything that changes what a run does or shows. */
export const computeWidgetContentHash = (input: {
  manifest?: WidgetManifest | null;
  outputType: WidgetOutputType;
  runtime: DashboardWidgetRuntime;
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

/**
 * Widgets, their script versions and run history.
 *
 * Instance methods are ownership-scoped like `DashboardModel`: reads follow
 * `buildWorkspaceWhere`, writes (edit, version, publish, trash) are limited to
 * the creator, while any reader may trigger a run. The static methods at the
 * bottom are the scheduler's cross-user entry points and must only be called
 * from trusted server code.
 */
export class DashboardWidgetModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private get ctx() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private readable() {
    return and(
      buildWorkspaceWhere(this.ctx, dashboardWidgets),
      isNotTrashed(dashboardWidgets.isDeleted),
    );
  }

  private manageable() {
    return and(this.readable(), eq(dashboardWidgets.userId, this.userId));
  }

  // ── Widgets ──

  async create(input: CreateDashboardWidgetInput) {
    const scope = { agentId: input.agentId ?? null, projectId: input.projectId ?? null };
    await assertDashboardScope(this.db, this.ctx, scope);

    const [widget] = await this.db
      .insert(dashboardWidgets)
      .values(buildWorkspacePayload(this.ctx, { ...input, ...scope }))
      .returning();

    return widget;
  }

  async findById(id: string) {
    const [widget] = await this.db
      .select()
      .from(dashboardWidgets)
      .where(and(eq(dashboardWidgets.id, id), this.readable()))
      .limit(1);

    return widget;
  }

  /** Widgets living directly on one level, most recently updated first. */
  async list(filter: DashboardLevelFilter = {}) {
    return this.db
      .select()
      .from(dashboardWidgets)
      .where(and(this.readable(), buildDashboardLevelWhere(dashboardWidgets, filter)))
      .orderBy(desc(dashboardWidgets.updatedAt));
  }

  async update(id: string, input: UpdateDashboardWidgetInput) {
    const [widget] = await this.db
      .update(dashboardWidgets)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(dashboardWidgets.id, id), this.manageable()))
      .returning();

    return widget;
  }

  /**
   * Move a widget to the recycle bin. Trashed widgets drop out of boards and
   * of the scheduler's due query; versions and runs stay for restore.
   */
  async trash(id: string) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [widget] = await tx
        .update(dashboardWidgets)
        .set(trashStamp(now))
        .where(and(eq(dashboardWidgets.id, id), this.manageable()))
        .returning();
      if (!widget) return undefined;

      await registerTrashItem(tx as LobeChatDatabase, {
        deletedByUserId: this.userId,
        now,
        resourceId: widget.id,
        resourceType: 'dashboardWidget',
        title: widget.title,
        userId: widget.userId,
        workspaceId: widget.workspaceId,
      });

      return widget;
    });
  }

  async restore(id: string) {
    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .update(dashboardWidgets)
        .set(restoreStamp())
        .where(
          and(
            eq(dashboardWidgets.id, id),
            buildWorkspaceWhere(this.ctx, dashboardWidgets),
            eq(dashboardWidgets.userId, this.userId),
            sql`${dashboardWidgets.isDeleted} IS TRUE`,
          ),
        )
        .returning();
      if (!widget) return undefined;

      await unregisterTrashItem(tx as LobeChatDatabase, 'dashboardWidget', widget.id);
      return widget;
    });
  }

  /** Hard delete; versions, runs and board placements cascade. */
  async delete(id: string) {
    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .delete(dashboardWidgets)
        .where(
          and(
            eq(dashboardWidgets.id, id),
            buildWorkspaceWhere(this.ctx, dashboardWidgets),
            eq(dashboardWidgets.userId, this.userId),
          ),
        )
        .returning();
      if (!widget) return undefined;

      await unregisterTrashItem(tx as LobeChatDatabase, 'dashboardWidget', widget.id);
      return widget;
    });
  }

  // ── Versions ──

  /**
   * Record a new draft version and make it the widget's current draft. When
   * the content is identical to the current draft, that draft is returned
   * instead of minting a duplicate.
   */
  async createVersion(widgetId: string, input: CreateDashboardWidgetVersionInput) {
    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .select()
        .from(dashboardWidgets)
        .where(and(eq(dashboardWidgets.id, widgetId), this.manageable()))
        .limit(1)
        .for('update');
      if (!widget) return undefined;

      const contentHash = computeWidgetContentHash(input);

      if (widget.draftVersionId) {
        const [draft] = await tx
          .select()
          .from(dashboardWidgetVersions)
          .where(eq(dashboardWidgetVersions.id, widget.draftVersionId))
          .limit(1);
        if (draft?.contentHash === contentHash) return draft;
      }

      const [latest] = await tx
        .select({ version: max(dashboardWidgetVersions.version) })
        .from(dashboardWidgetVersions)
        .where(eq(dashboardWidgetVersions.widgetId, widgetId));

      const [version] = await tx
        .insert(dashboardWidgetVersions)
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
        .update(dashboardWidgets)
        .set({ draftVersionId: version.id, updatedAt: new Date() })
        .where(eq(dashboardWidgets.id, widgetId));

      return version;
    });
  }

  async listVersions(widgetId: string) {
    const widget = await this.findById(widgetId);
    if (!widget) return [];

    return this.db
      .select()
      .from(dashboardWidgetVersions)
      .where(eq(dashboardWidgetVersions.widgetId, widgetId))
      .orderBy(desc(dashboardWidgetVersions.version));
  }

  async findVersion(widgetId: string, versionId: string) {
    const widget = await this.findById(widgetId);
    if (!widget) return undefined;

    const [version] = await this.db
      .select()
      .from(dashboardWidgetVersions)
      .where(
        and(
          eq(dashboardWidgetVersions.id, versionId),
          eq(dashboardWidgetVersions.widgetId, widgetId),
        ),
      )
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
    options: PublishDashboardWidgetVersionOptions = {},
  ) {
    return this.db.transaction(async (tx) => {
      const [widget] = await tx
        .select()
        .from(dashboardWidgets)
        .where(and(eq(dashboardWidgets.id, widgetId), this.manageable()))
        .limit(1)
        .for('update');
      if (!widget) return undefined;

      const now = new Date();
      const [version] = await tx
        .update(dashboardWidgetVersions)
        .set({ publishedAt: now, publishedByUserId: this.userId, status: 'published' })
        .where(
          and(
            eq(dashboardWidgetVersions.id, versionId),
            eq(dashboardWidgetVersions.widgetId, widgetId),
          ),
        )
        .returning();
      if (!version) return undefined;

      if (widget.publishedVersionId && widget.publishedVersionId !== versionId) {
        await tx
          .update(dashboardWidgetVersions)
          .set({ status: 'archived' })
          .where(eq(dashboardWidgetVersions.id, widget.publishedVersionId));
      }

      const [updated] = await tx
        .update(dashboardWidgets)
        .set({
          ...(widget.draftVersionId === versionId && { draftVersionId: null }),
          ...(options.nextRunAt !== undefined && { nextRunAt: options.nextRunAt }),
          publishedVersionId: versionId,
          updatedAt: now,
        })
        .where(eq(dashboardWidgets.id, widgetId))
        .returning();

      return { version, widget: updated };
    });
  }

  // ── Runs ──

  /** Open a run for a readable widget. Any reader may refresh a widget. */
  async startRun(widgetId: string, input: StartDashboardWidgetRunInput) {
    const widget = await this.findById(widgetId);
    if (!widget) return undefined;

    return DashboardWidgetModel.startRun(this.db, widget, input);
  }

  async finishRun(runId: string, input: FinishDashboardWidgetRunInput) {
    const [run] = await this.db
      .select({ id: dashboardWidgetRuns.id })
      .from(dashboardWidgetRuns)
      .innerJoin(dashboardWidgets, eq(dashboardWidgetRuns.widgetId, dashboardWidgets.id))
      .where(and(eq(dashboardWidgetRuns.id, runId), this.readable()))
      .limit(1);
    if (!run) return undefined;

    return DashboardWidgetModel.finishRun(this.db, runId, input);
  }

  async listRuns(widgetId: string, options: { limit?: number } = {}) {
    const widget = await this.findById(widgetId);
    if (!widget) return [];

    return this.db
      .select()
      .from(dashboardWidgetRuns)
      .where(eq(dashboardWidgetRuns.widgetId, widgetId))
      .orderBy(desc(dashboardWidgetRuns.createdAt))
      .limit(options.limit ?? 20);
  }

  // ── Scheduler (trusted, cross-user) ──

  /**
   * Live, published, scheduled widgets whose `next_run_at` has passed, with
   * the version to execute. Walks `dashboard_widgets_due_idx`.
   */
  static async findDue(db: LobeChatDatabase, options: { limit?: number; now?: Date } = {}) {
    return db
      .select({ version: dashboardWidgetVersions, widget: dashboardWidgets })
      .from(dashboardWidgets)
      .innerJoin(
        dashboardWidgetVersions,
        eq(dashboardWidgets.publishedVersionId, dashboardWidgetVersions.id),
      )
      .where(
        and(
          isNotNull(dashboardWidgets.nextRunAt),
          isNotNull(dashboardWidgets.schedulePattern),
          isNotNull(dashboardWidgets.publishedVersionId),
          isNotTrashed(dashboardWidgets.isDeleted),
          lte(dashboardWidgets.nextRunAt, options.now ?? new Date()),
        ),
      )
      .orderBy(asc(dashboardWidgets.nextRunAt))
      .limit(options.limit ?? 50);
  }

  /**
   * Claim one due slot by moving `next_run_at` forward, only if it still
   * holds the value the caller read. Returns false when another tick won.
   */
  static async claimDue(
    db: LobeChatDatabase,
    params: { expectedNextRunAt: Date; nextRunAt: Date | null; widgetId: string },
  ): Promise<boolean> {
    const rows = await db
      .update(dashboardWidgets)
      .set({ nextRunAt: params.nextRunAt })
      .where(
        and(
          eq(dashboardWidgets.id, params.widgetId),
          eq(dashboardWidgets.nextRunAt, params.expectedNextRunAt),
        ),
      )
      .returning({ id: dashboardWidgets.id });

    return rows.length > 0;
  }

  /** Insert a `running` run owned by the widget's owner and workspace. */
  static async startRun(
    db: LobeChatDatabase,
    widget: Pick<
      DashboardWidgetRow,
      'draftVersionId' | 'id' | 'publishedVersionId' | 'userId' | 'workspaceId'
    >,
    input: StartDashboardWidgetRunInput,
  ) {
    const versionId =
      input.versionId ??
      (input.trigger === 'preview'
        ? (widget.draftVersionId ?? widget.publishedVersionId)
        : widget.publishedVersionId);
    if (!versionId) throw new Error('Widget has no version to run');

    const [version] = await db
      .select({ id: dashboardWidgetVersions.id })
      .from(dashboardWidgetVersions)
      .where(
        and(
          eq(dashboardWidgetVersions.id, versionId),
          eq(dashboardWidgetVersions.widgetId, widget.id),
        ),
      )
      .limit(1);
    if (!version) throw new Error('Version does not belong to this widget');

    const [run] = await db
      .insert(dashboardWidgetRuns)
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
   * Close a running run and, unless it was a preview, fold the result into
   * the widget snapshot: success stores the output and resets the failure
   * streak, anything else increments it. Finishing an already-finished run is
   * a no-op that returns undefined.
   */
  static async finishRun(
    db: LobeChatDatabase,
    runId: string,
    input: FinishDashboardWidgetRunInput,
  ) {
    return db.transaction(async (tx) => {
      const finishedAt = input.finishedAt ?? new Date();
      const [run] = await tx
        .update(dashboardWidgetRuns)
        .set({
          durationMs:
            input.durationMs ??
            sql<number>`GREATEST(0, (EXTRACT(EPOCH FROM (${finishedAt.toISOString()}::timestamptz - ${dashboardWidgetRuns.startedAt})) * 1000)::integer)`,
          error: input.error ?? null,
          exitCode: input.exitCode ?? null,
          finishedAt,
          output: input.output ?? null,
          sandboxId: input.sandboxId ?? null,
          status: input.status,
          stderr: input.stderr ?? null,
          stdout: input.stdout ?? null,
        })
        .where(and(eq(dashboardWidgetRuns.id, runId), eq(dashboardWidgetRuns.status, 'running')))
        .returning();
      if (!run) return undefined;

      if (run.trigger === 'preview') return run;

      const succeeded = input.status === 'succeeded';
      await tx
        .update(dashboardWidgets)
        .set({
          consecutiveFailures: succeeded ? 0 : sql`${dashboardWidgets.consecutiveFailures} + 1`,
          lastRunAt: finishedAt,
          lastRunError: input.error ?? null,
          lastRunId: run.id,
          lastRunStatus: input.status,
          ...(succeeded && { latestOutput: input.output ?? null, latestOutputAt: finishedAt }),
        })
        .where(eq(dashboardWidgets.id, run.widgetId));

      return run;
    });
  }
}
