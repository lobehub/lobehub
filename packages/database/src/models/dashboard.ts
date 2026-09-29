import type {
  DashboardItemLayout,
  DashboardLevelFilter,
  DashboardVisibility,
} from '@lobechat/types';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { dashboardItems, dashboards, dashboardWidgets } from '../schemas/dashboard';
import type { LobeChatDatabase } from '../type';
import {
  assertDashboardScope,
  buildDashboardLevelWhere,
  DashboardScopeError,
  isNotTrashed,
} from '../utils/dashboardScope';
import {
  registerTrashItem,
  restoreStamp,
  trashStamp,
  unregisterTrashItem,
} from '../utils/trashRegistry';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface CreateDashboardInput {
  agentId?: string | null;
  description?: string | null;
  icon?: string | null;
  projectId?: string | null;
  sortOrder?: number;
  title: string;
  visibility?: DashboardVisibility;
}

export interface UpdateDashboardInput {
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
  title?: string;
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
 * Boards and the placement of widgets on them. Scope columns (workspace /
 * project / agent) are fixed at creation; reads follow `buildWorkspaceWhere`
 * (workspace members see public boards and their own private ones), writes
 * are limited to the creator, mirroring `ProjectModel`.
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

  private readable() {
    return and(buildWorkspaceWhere(this.ctx, dashboards), isNotTrashed(dashboards.isDeleted));
  }

  private manageable() {
    return and(this.readable(), eq(dashboards.userId, this.userId));
  }

  /** Creator-owned and currently in the recycle bin. */
  private trashed() {
    return and(
      buildWorkspaceWhere(this.ctx, dashboards),
      eq(dashboards.userId, this.userId),
      sql`${dashboards.isDeleted} IS TRUE`,
    );
  }

  // ── Dashboards ──

  async create(input: CreateDashboardInput) {
    const scope = { agentId: input.agentId ?? null, projectId: input.projectId ?? null };
    await assertDashboardScope(this.db, this.ctx, scope);

    const [dashboard] = await this.db
      .insert(dashboards)
      .values(buildWorkspacePayload(this.ctx, { ...input, ...scope }))
      .returning();

    return dashboard;
  }

  async findById(id: string) {
    const [dashboard] = await this.db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), this.readable()))
      .limit(1);

    return dashboard;
  }

  /** Boards living directly on one level; see `buildDashboardLevelWhere`. */
  async list(filter: DashboardLevelFilter = {}) {
    return this.db
      .select()
      .from(dashboards)
      .where(and(this.readable(), buildDashboardLevelWhere(dashboards, filter)))
      .orderBy(asc(dashboards.sortOrder), asc(dashboards.createdAt));
  }

  async update(id: string, input: UpdateDashboardInput) {
    const [dashboard] = await this.db
      .update(dashboards)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(dashboards.id, id), this.manageable()))
      .returning();

    return dashboard;
  }

  /** Move a board to the recycle bin. Its items stay intact for restore. */
  async trash(id: string) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [dashboard] = await tx
        .update(dashboards)
        .set(trashStamp(now))
        .where(and(eq(dashboards.id, id), this.manageable()))
        .returning();
      if (!dashboard) return undefined;

      await registerTrashItem(tx as LobeChatDatabase, {
        deletedByUserId: this.userId,
        now,
        resourceId: dashboard.id,
        resourceType: 'dashboard',
        title: dashboard.title,
        userId: dashboard.userId,
        workspaceId: dashboard.workspaceId,
      });

      return dashboard;
    });
  }

  async restore(id: string) {
    return this.db.transaction(async (tx) => {
      const [dashboard] = await tx
        .update(dashboards)
        .set(restoreStamp())
        .where(and(eq(dashboards.id, id), this.trashed()))
        .returning();
      if (!dashboard) return undefined;

      await unregisterTrashItem(tx as LobeChatDatabase, 'dashboard', dashboard.id);
      return dashboard;
    });
  }

  /** Hard delete, live or trashed; items cascade, widgets are untouched. */
  async delete(id: string) {
    return this.db.transaction(async (tx) => {
      const [dashboard] = await tx
        .delete(dashboards)
        .where(
          and(
            eq(dashboards.id, id),
            buildWorkspaceWhere(this.ctx, dashboards),
            eq(dashboards.userId, this.userId),
          ),
        )
        .returning();
      if (!dashboard) return undefined;

      await unregisterTrashItem(tx as LobeChatDatabase, 'dashboard', dashboard.id);
      return dashboard;
    });
  }

  // ── Items ──

  /**
   * Place a widget on a board (or update its placement if already there). The
   * widget must be visible to the caller and share the board's workspace.
   */
  async addItem(dashboardId: string, widgetId: string, input: AddDashboardItemInput = {}) {
    const [dashboard] = await this.db
      .select({ id: dashboards.id, workspaceId: dashboards.workspaceId })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), this.manageable()))
      .limit(1);
    if (!dashboard) return undefined;

    const [widget] = await this.db
      .select({ id: dashboardWidgets.id, workspaceId: dashboardWidgets.workspaceId })
      .from(dashboardWidgets)
      .where(
        and(
          eq(dashboardWidgets.id, widgetId),
          buildWorkspaceWhere(this.ctx, dashboardWidgets),
          isNotTrashed(dashboardWidgets.isDeleted),
        ),
      )
      .limit(1);
    if (!widget) return undefined;

    if (widget.workspaceId !== dashboard.workspaceId) {
      throw new DashboardScopeError(
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

  /** Items of a readable board with their (live) widgets, in display order. */
  async listItems(dashboardId: string) {
    const dashboard = await this.findById(dashboardId);
    if (!dashboard) return [];

    return this.db
      .select({ item: dashboardItems, widget: dashboardWidgets })
      .from(dashboardItems)
      .innerJoin(dashboardWidgets, eq(dashboardItems.widgetId, dashboardWidgets.id))
      .where(
        and(eq(dashboardItems.dashboardId, dashboardId), isNotTrashed(dashboardWidgets.isDeleted)),
      )
      .orderBy(asc(dashboardItems.sortOrder), asc(dashboardItems.createdAt));
  }

  /** Readable boards a widget is placed on, in board order. */
  async listByWidget(widgetId: string) {
    return this.db
      .select({ id: dashboards.id, title: dashboards.title })
      .from(dashboardItems)
      .innerJoin(dashboards, eq(dashboardItems.dashboardId, dashboards.id))
      .where(and(eq(dashboardItems.widgetId, widgetId), this.readable()))
      .orderBy(asc(dashboards.sortOrder), asc(dashboards.createdAt));
  }

  /** Persist a drag-and-drop result; ignores ids that are not on this board. */
  async updateItemLayouts(dashboardId: string, patches: DashboardItemLayoutPatch[]) {
    const dashboard = await this.assertManageable(dashboardId);
    if (!dashboard || patches.length === 0) return 0;

    return this.db.transaction(async (tx) => {
      let updated = 0;
      for (const patch of patches) {
        const rows = await tx
          .update(dashboardItems)
          .set({
            ...(patch.layout !== undefined && { layout: patch.layout }),
            ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
            updatedAt: new Date(),
          })
          .where(and(eq(dashboardItems.id, patch.id), eq(dashboardItems.dashboardId, dashboardId)))
          .returning({ id: dashboardItems.id });
        updated += rows.length;
      }
      return updated;
    });
  }

  async removeItems(dashboardId: string, itemIds: string[]) {
    const dashboard = await this.assertManageable(dashboardId);
    if (!dashboard || itemIds.length === 0) return 0;

    const rows = await this.db
      .delete(dashboardItems)
      .where(and(eq(dashboardItems.dashboardId, dashboardId), inArray(dashboardItems.id, itemIds)))
      .returning({ id: dashboardItems.id });

    return rows.length;
  }

  private async assertManageable(dashboardId: string) {
    const [dashboard] = await this.db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), this.manageable()))
      .limit(1);
    return dashboard;
  }

  private async nextSortOrder(dashboardId: string) {
    const [row] = await this.db
      .select({ max: sql<number | null>`max(${dashboardItems.sortOrder})` })
      .from(dashboardItems)
      .where(eq(dashboardItems.dashboardId, dashboardId));
    return row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1;
  }
}
