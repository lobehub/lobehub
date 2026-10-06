import type { DashboardItemLayout, DashboardVisibility, WidgetLevelFilter } from '@lobechat/types';
import { and, asc, eq, inArray, max } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { dashboardItems, dashboards } from '../schemas/dashboard';
import { projects } from '../schemas/project';
import { widgets } from '../schemas/widget';
import type { LobeChatDatabase, Transaction } from '../type';
import {
  assertScopeParents,
  buildDirectLevelWhere,
  buildParentVisibilityWhere,
  buildProjectWhere,
  hasPrivateParent,
  ScopeLevelError,
} from '../utils/scopeLevel';
import { isTrashed, restoreStamp, trashStamp } from '../utils/softDelete';
import { isUuid } from '../utils/uuid';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { TrashModel } from './trash';

export interface CreateDashboardInput {
  agentId?: string | null;
  description?: string | null;
  icon?: string | null;
  metadata?: Record<string, unknown> | null;
  projectId?: string | null;
  sortOrder?: number;
  title: string;
  /** Ignored (forced to 'private') when the attached project or agent is private. */
  visibility?: DashboardVisibility;
}

export interface UpdateDashboardInput {
  description?: string | null;
  icon?: string | null;
  metadata?: Record<string, unknown> | null;
  sortOrder?: number;
  title?: string;
  /** 'public' is refused (kept 'private') while the project or agent is private. */
  visibility?: DashboardVisibility;
}

export interface AddDashboardItemInput {
  layout?: DashboardItemLayout | null;
  sortOrder?: number;
}

export interface DashboardItemLayoutPatch {
  id: string;
  layout?: DashboardItemLayout | null;
  sortOrder?: number;
}

/**
 * Boards and the placement of widgets on them.
 *
 * Same scope model as `WidgetModel`: scope columns (workspace / project /
 * agent) are fixed at creation and checked by `assertScopeParents`; reads
 * follow `buildWorkspaceWhere` plus the current visibility of the attached
 * project / agent; writes are limited to the creator. Role-based permissions
 * are enforced in the routers.
 */
export class DashboardModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private get ctx() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  /** Visible to the caller, live, and not hidden by a private parent. */
  private readable() {
    return and(
      buildWorkspaceWhere(this.ctx, dashboards),
      buildParentVisibilityWhere(this.ctx, dashboards),
    );
  }

  private manageable() {
    return and(this.readable(), eq(dashboards.userId, this.userId));
  }

  /** The caller's own boards, trashed or not — for restore and hard delete. */
  private ownedIncludingTrashed() {
    return and(
      buildWorkspaceWhere({ ...this.ctx, includeTrashed: true }, dashboards),
      eq(dashboards.userId, this.userId),
    );
  }

  /** Widgets the caller may see on a board: the widget's own read rule. */
  private readableWidget() {
    return and(
      buildWorkspaceWhere(this.ctx, widgets),
      buildParentVisibilityWhere(this.ctx, widgets),
    );
  }

  // ── Dashboards ──

  async create(input: CreateDashboardInput) {
    const scope = { agentId: input.agentId ?? null, projectId: input.projectId ?? null };
    const parents = await assertScopeParents(this.db, this.ctx, scope);
    const visibility: DashboardVisibility | undefined = hasPrivateParent(parents)
      ? 'private'
      : input.visibility;

    const [dashboard] = await this.db
      .insert(dashboards)
      .values(buildWorkspacePayload(this.ctx, { ...input, ...scope, visibility }))
      .returning();

    return dashboard;
  }

  async findById(id: string) {
    if (!isUuid(id)) return undefined;

    const [dashboard] = await this.db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), this.readable()))
      .limit(1);

    return dashboard;
  }

  /** Boards living directly on one level, in board order. */
  async list(filter: WidgetLevelFilter = {}) {
    return this.db
      .select()
      .from(dashboards)
      .where(and(this.readable(), buildDirectLevelWhere(dashboards, filter)))
      .orderBy(asc(dashboards.sortOrder), asc(dashboards.createdAt));
  }

  /** Every board of a project, including those an agent of the project also owns. */
  async listByProject(projectId: string) {
    return this.db
      .select()
      .from(dashboards)
      .where(and(this.readable(), buildProjectWhere(dashboards, projectId)))
      .orderBy(asc(dashboards.sortOrder), asc(dashboards.createdAt));
  }

  async update(id: string, input: UpdateDashboardInput) {
    if (!isUuid(id)) return undefined;

    const values = { ...input };
    if (values.visibility === 'public' && (await this.hasPrivateParent(id))) {
      values.visibility = 'private';
    }

    const [dashboard] = await this.db
      .update(dashboards)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(dashboards.id, id), this.manageable()))
      .returning();

    return dashboard;
  }

  /** Move a board to the recycle bin. Its items stay intact for restore. */
  async trash(id: string) {
    if (!isUuid(id)) return undefined;

    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [dashboard] = await tx
        .update(dashboards)
        .set(trashStamp(now))
        .where(and(eq(dashboards.id, id), this.manageable()))
        .returning();
      if (!dashboard) return undefined;

      await this.trashRegistry(tx).register(
        {
          deletedAt: now,
          root: { resourceId: dashboard.id, resourceType: 'dashboard', title: dashboard.title },
        },
        tx,
      );

      return dashboard;
    });
  }

  async restore(id: string) {
    if (!isUuid(id)) return undefined;

    return this.db.transaction(async (tx) => {
      const [dashboard] = await tx
        .update(dashboards)
        .set(restoreStamp())
        .where(
          and(eq(dashboards.id, id), this.ownedIncludingTrashed(), isTrashed(dashboards.isDeleted)),
        )
        .returning();
      if (!dashboard) return undefined;

      await this.trashRegistry(tx).removeByResources(
        [{ resourceId: dashboard.id, resourceType: 'dashboard' }],
        tx,
      );
      return dashboard;
    });
  }

  /** Hard delete, live or trashed; items cascade, widgets are untouched. */
  async delete(id: string) {
    return this.hardDelete(id, false);
  }

  /**
   * Permanently delete a dashboard the recycle bin still holds. Gated on
   * `is_deleted` so a restore that commits after the purge read the registry
   * keeps the row instead of losing it.
   */
  async purge(id: string) {
    return this.hardDelete(id, true);
  }

  private async hardDelete(id: string, onlyTrashed: boolean) {
    if (!isUuid(id)) return undefined;

    return this.db.transaction(async (tx) => {
      const [dashboard] = await tx
        .delete(dashboards)
        .where(
          and(
            eq(dashboards.id, id),
            this.ownedIncludingTrashed(),
            onlyTrashed ? isTrashed(dashboards.isDeleted) : undefined,
          ),
        )
        .returning();
      if (!dashboard) return undefined;

      await this.trashRegistry(tx).removeByResources(
        [{ resourceId: dashboard.id, resourceType: 'dashboard' }],
        tx,
      );
      return dashboard;
    });
  }

  // ── Items ──

  /**
   * Place a widget on a board (or update its placement if already there). The
   * widget must be readable by the caller and share the board's workspace.
   */
  async addItem(dashboardId: string, widgetId: string, input: AddDashboardItemInput = {}) {
    if (!isUuid(dashboardId) || !isUuid(widgetId)) return undefined;

    const [dashboard] = await this.db
      .select({ id: dashboards.id, workspaceId: dashboards.workspaceId })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), this.manageable()))
      .limit(1);
    if (!dashboard) return undefined;

    const [widget] = await this.db
      .select({ id: widgets.id, workspaceId: widgets.workspaceId })
      .from(widgets)
      .where(and(eq(widgets.id, widgetId), this.readableWidget()))
      .limit(1);
    if (!widget) return undefined;

    if (widget.workspaceId !== dashboard.workspaceId) {
      throw new ScopeLevelError(
        'SCOPE_MISMATCH',
        'Widget belongs to a different workspace than the dashboard',
      );
    }

    const sortOrder = input.sortOrder ?? (await this.nextSortOrder(dashboardId));
    const [item] = await this.db
      .insert(dashboardItems)
      .values({
        dashboardId,
        layout: input.layout ?? null,
        sortOrder,
        userId: this.userId,
        widgetId,
        workspaceId: dashboard.workspaceId,
      })
      .onConflictDoUpdate({
        set: {
          ...(input.layout !== undefined && { layout: input.layout }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          updatedAt: new Date(),
        },
        target: [dashboardItems.dashboardId, dashboardItems.widgetId],
      })
      .returning();

    return item;
  }

  /**
   * Items of a readable board with their widgets, in display order. Widgets the
   * caller cannot read (trashed, private to a teammate, under a private
   * parent) drop out without losing their placement.
   */
  async listItems(dashboardId: string) {
    const dashboard = await this.findById(dashboardId);
    if (!dashboard) return [];

    return this.db
      .select({ item: dashboardItems, widget: widgets })
      .from(dashboardItems)
      .innerJoin(widgets, eq(dashboardItems.widgetId, widgets.id))
      .where(and(eq(dashboardItems.dashboardId, dashboardId), this.readableWidget()))
      .orderBy(asc(dashboardItems.sortOrder), asc(dashboardItems.createdAt));
  }

  /**
   * {@link listItems} for many boards in one query: items of the readable
   * boards among `dashboardIds` (unreadable, trashed or unknown ids yield
   * nothing), each with its readable widget, in display order per board.
   */
  async listItemsForDashboards(dashboardIds: string[]) {
    const ids = [...new Set(dashboardIds.filter(isUuid))];
    if (ids.length === 0) return [];

    return this.db
      .select({ item: dashboardItems, widget: widgets })
      .from(dashboardItems)
      .innerJoin(dashboards, eq(dashboardItems.dashboardId, dashboards.id))
      .innerJoin(widgets, eq(dashboardItems.widgetId, widgets.id))
      .where(and(inArray(dashboardItems.dashboardId, ids), this.readable(), this.readableWidget()))
      .orderBy(asc(dashboardItems.sortOrder), asc(dashboardItems.createdAt));
  }

  /** Readable boards a widget is placed on, in board order. */
  async listByWidget(widgetId: string) {
    if (!isUuid(widgetId)) return [];

    return this.db
      .select({ id: dashboards.id, projectId: dashboards.projectId, title: dashboards.title })
      .from(dashboardItems)
      .innerJoin(dashboards, eq(dashboardItems.dashboardId, dashboards.id))
      .where(and(eq(dashboardItems.widgetId, widgetId), this.readable()))
      .orderBy(asc(dashboards.sortOrder), asc(dashboards.createdAt));
  }

  /** Persist a drag-and-drop result; ignores ids that are not on this board. */
  async updateItemLayouts(dashboardId: string, patches: DashboardItemLayoutPatch[]) {
    const validPatches = patches.filter((patch) => isUuid(patch.id));
    if (validPatches.length === 0 || !(await this.isManageable(dashboardId))) return 0;

    return this.db.transaction(async (tx) => {
      let updated = 0;
      const now = new Date();
      for (const patch of validPatches) {
        const rows = await tx
          .update(dashboardItems)
          .set({
            ...(patch.layout !== undefined && { layout: patch.layout }),
            ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
            updatedAt: now,
          })
          .where(and(eq(dashboardItems.id, patch.id), eq(dashboardItems.dashboardId, dashboardId)))
          .returning({ id: dashboardItems.id });
        updated += rows.length;
      }
      return updated;
    });
  }

  async removeItems(dashboardId: string, itemIds: string[]) {
    const ids = itemIds.filter(isUuid);
    if (ids.length === 0 || !(await this.isManageable(dashboardId))) return 0;

    const rows = await this.db
      .delete(dashboardItems)
      .where(and(eq(dashboardItems.dashboardId, dashboardId), inArray(dashboardItems.id, ids)))
      .returning({ id: dashboardItems.id });

    return rows.length;
  }

  private async isManageable(dashboardId: string) {
    if (!isUuid(dashboardId)) return false;

    const [dashboard] = await this.db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), this.manageable()))
      .limit(1);
    return !!dashboard;
  }

  private async nextSortOrder(dashboardId: string) {
    const [row] = await this.db
      .select({ max: max(dashboardItems.sortOrder) })
      .from(dashboardItems)
      .where(eq(dashboardItems.dashboardId, dashboardId));
    return row?.max === null || row?.max === undefined ? 0 : row.max + 1;
  }

  private trashRegistry(tx: Transaction) {
    return new TrashModel(tx as unknown as LobeChatDatabase, this.userId, this.workspaceId);
  }

  /** Whether the board's project or agent is currently private. */
  private async hasPrivateParent(id: string) {
    const [row] = await this.db
      .select({ agentVisibility: agents.visibility, projectVisibility: projects.visibility })
      .from(dashboards)
      .leftJoin(projects, eq(dashboards.projectId, projects.id))
      .leftJoin(agents, eq(dashboards.agentId, agents.id))
      .where(eq(dashboards.id, id))
      .limit(1);

    return row?.projectVisibility === 'private' || row?.agentVisibility === 'private';
  }
}
