import { DashboardModel } from '@/database/models/dashboard';
import { DashboardWidgetModel } from '@/database/models/dashboardWidget';
import type { TrashItemRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { type TrashHandler, TrashRestoreError } from './types';

/**
 * Dashboards and widgets register their own `trash_items` row when the
 * dashboard router trashes them (see `DashboardModel.trash`). The models scope
 * restore / delete to the row owner, so both run as the registry row's owner:
 * the service has already checked the caller may act on that row.
 */
const ownerScope = (db: LobeChatDatabase, root: TrashItemRow) =>
  [db, root.userId, root.workspaceId ?? undefined] as const;

export const dashboardHandler: TrashHandler = {
  purge: async (ctx, root) => {
    await new DashboardModel(...ownerScope(ctx.db, root)).delete(root.resourceId);
  },
  restore: async (ctx, root) => {
    const restored = await new DashboardModel(...ownerScope(ctx.db, root)).restore(root.resourceId);
    if (!restored) throw new TrashRestoreError('notFound');
  },
  type: 'dashboard',
};

export const dashboardWidgetHandler: TrashHandler = {
  purge: async (ctx, root) => {
    await new DashboardWidgetModel(...ownerScope(ctx.db, root)).delete(root.resourceId);
  },
  restore: async (ctx, root) => {
    const restored = await new DashboardWidgetModel(...ownerScope(ctx.db, root)).restore(
      root.resourceId,
    );
    if (!restored) throw new TrashRestoreError('notFound');
  },
  type: 'dashboardWidget',
};
