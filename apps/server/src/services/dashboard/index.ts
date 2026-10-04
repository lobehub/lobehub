import type { DashboardItemLayout } from '@lobechat/types';

import {
  type AddDashboardItemInput,
  type DashboardItemLayoutPatch,
  DashboardModel,
} from '@/database/models/dashboard';
import type { LobeChatDatabase } from '@/database/type';

/** Grid bounds a placed item must stay within. */
export const DASHBOARD_GRID = {
  maxColumns: 96,
  maxSpan: 48,
} as const;

/**
 * Keep a layout on the grid: integer cells, a span of at least one cell, and
 * no item starting past the last column.
 */
export const normalizeItemLayout = (layout: DashboardItemLayout): DashboardItemLayout => {
  const cell = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(value)));
  return {
    h: cell(layout.h, 1, DASHBOARD_GRID.maxSpan),
    w: cell(layout.w, 1, DASHBOARD_GRID.maxSpan),
    x: cell(layout.x, 0, DASHBOARD_GRID.maxColumns),
    y: cell(layout.y, 0, Number.MAX_SAFE_INTEGER),
  };
};

/**
 * Boards and the placement of widgets on them, on behalf of one caller.
 * Access follows `DashboardModel`: reads see readable boards (and only the
 * widgets the caller may read), writes are limited to the board's creator.
 */
export class DashboardService {
  private readonly model: DashboardModel;

  constructor(
    db: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string,
  ) {
    this.model = new DashboardModel(db, userId, workspaceId);
  }

  /** A readable board with its visible items, in display order. */
  async getDetail(dashboardId: string) {
    const dashboard = await this.model.findById(dashboardId);
    if (!dashboard) return undefined;

    const items = await this.model.listItems(dashboardId);
    return { ...dashboard, items };
  }

  /** The board when the caller may change it (creator of a readable board). */
  async findManageable(dashboardId: string) {
    const dashboard = await this.model.findById(dashboardId);
    return dashboard?.userId === this.userId ? dashboard : undefined;
  }

  /** Place a widget on a board, or move it when it is already there. */
  async placeWidget(dashboardId: string, widgetId: string, input: AddDashboardItemInput = {}) {
    return this.model.addItem(dashboardId, widgetId, {
      ...input,
      layout: input.layout ? normalizeItemLayout(input.layout) : input.layout,
    });
  }

  /** Persist a drag-and-drop result; returns how many items moved. */
  async saveLayout(dashboardId: string, patches: DashboardItemLayoutPatch[]) {
    return this.model.updateItemLayouts(
      dashboardId,
      patches.map((patch) => ({
        ...patch,
        layout: patch.layout ? normalizeItemLayout(patch.layout) : patch.layout,
      })),
    );
  }

  async removeItems(dashboardId: string, itemIds: string[]) {
    return this.model.removeItems(dashboardId, itemIds);
  }
}
