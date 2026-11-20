import { DashboardModel } from '@/database/models/dashboard';

import { type TrashHandler, type TrashHandlerContext, TrashRestoreError } from './types';

/**
 * Dashboards register their own `trash_items` row when trashed (see
 * `DashboardModel.trash`). The model scopes restore / delete to the board's
 * creator, so both run as the registry row's owner: the service has already
 * checked the caller may act on that row.
 */
const ownerModel = (
  ctx: TrashHandlerContext,
  root: { userId: string; workspaceId: string | null },
) => new DashboardModel(ctx.db, root.userId, root.workspaceId ?? undefined);

export const dashboardHandler: TrashHandler = {
  purge: async (ctx, root) => {
    await ownerModel(ctx, root).purge(root.resourceId);
  },
  restore: async (ctx, root) => {
    const restored = await ownerModel(ctx, root).restore(root.resourceId);
    if (!restored) throw new TrashRestoreError('notFound');
  },
  type: 'dashboard',
};
