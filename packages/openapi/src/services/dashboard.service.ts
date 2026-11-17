import type { DashboardItemLayout } from '@lobechat/types';

import type { DashboardItemRow, DashboardRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { dashboardRouter } from '@/server/routers/lambda/dashboard';

import { BaseService } from '../common/base.service';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  AddDashboardItemRequest,
  CreateDashboardRequest,
  DashboardDetailResponse,
  DashboardItemResponse,
  DashboardListQuery,
  DashboardResponse,
  UpdateDashboardLayoutRequest,
  UpdateDashboardRequest,
} from '../types/dashboard.type';
import type { WidgetVersionResponse } from '../types/widget.type';
import { toWidget } from './widget.service';

const toIso = (value: Date | string): string => new Date(value).toISOString();

const toDashboard = (row: DashboardRow): DashboardResponse => ({
  agentId: row.agentId ?? null,
  createdAt: toIso(row.createdAt),
  description: row.description ?? null,
  icon: row.icon ?? null,
  id: row.id,
  metadata: row.metadata ?? null,
  projectId: row.projectId ?? null,
  sortOrder: row.sortOrder,
  title: row.title,
  updatedAt: toIso(row.updatedAt),
  userId: row.userId,
  visibility: row.visibility,
  workspaceId: row.workspaceId ?? null,
});

const toItem = (row: DashboardItemRow): DashboardItemResponse => ({
  createdAt: toIso(row.createdAt),
  dashboardId: row.dashboardId,
  id: row.id,
  layout: (row.layout as DashboardItemLayout | null) ?? null,
  sortOrder: row.sortOrder,
  updatedAt: toIso(row.updatedAt),
  widgetId: row.widgetId,
});

/**
 * Dashboards REST service.
 *
 * Every call goes through the `dashboard` tRPC procedures, called server-side,
 * so REST shares their gates: the `dashboard` feature flag, the workspace
 * member role on writes, creator-only edits and the per-board item limit. A
 * board shows only the widgets the caller may read. Missing and invisible
 * boards both read as 404.
 */
export class DashboardRestService extends BaseService {
  private readonly caller: ReturnType<typeof dashboardRouter.createCaller>;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.caller = dashboardRouter.createCaller({ userId: this.userId, workspaceId });
  }

  async listDashboards(query: DashboardListQuery) {
    const { limit, offset } = resolvePagination(query);
    const result = await this.caller.list({
      agentId: query.agentId ?? null,
      projectId: query.projectId ?? null,
    });
    const rows = result!.data;
    return { items: rows.slice(offset, offset + limit).map(toDashboard), total: rows.length };
  }

  async createDashboard(input: CreateDashboardRequest): Promise<DashboardResponse> {
    return toDashboard((await this.caller.create(input))!.data);
  }

  async getDashboard(id: string): Promise<DashboardDetailResponse> {
    const { items, ...board } = (await this.caller.detail({ id }))!.data;
    return {
      ...toDashboard(board),
      items: items.map(({ item, view, widget }) => ({
        ...toItem(item),
        view: (view ?? null) as WidgetVersionResponse['view'],
        widget: toWidget(widget),
      })),
    };
  }

  async updateDashboard(id: string, value: UpdateDashboardRequest): Promise<DashboardResponse> {
    return toDashboard((await this.caller.update({ id, value }))!.data);
  }

  async deleteDashboard(id: string): Promise<DeletedResource> {
    await this.caller.delete({ id });
    return { deleted: true, id };
  }

  async addItem(dashboardId: string, input: AddDashboardItemRequest) {
    const result = await this.caller.addItem({ dashboardId, ...input });
    return toItem(result!.data);
  }

  async removeItem(dashboardId: string, itemId: string): Promise<DeletedResource> {
    const removed = (await this.caller.removeItems({ dashboardId, itemIds: [itemId] }))!.data;
    // Nothing removed: not the creator, or the item is not on this board.
    if (removed === 0) throw this.createNotFoundError('Dashboard or its item not found');
    return { deleted: true, id: itemId };
  }

  async updateLayout(dashboardId: string, input: UpdateDashboardLayoutRequest) {
    const result = await this.caller.updateItemLayouts({ dashboardId, patches: input.items });
    return { updated: result!.data };
  }
}
