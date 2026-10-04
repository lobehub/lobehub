import { WidgetModel } from '@/database/models/widget';

import { type TrashHandler, type TrashHandlerContext, TrashRestoreError } from './types';

/**
 * Widgets register their own `trash_items` row when trashed (see
 * `WidgetModel.trash`). The model scopes restore / delete to the widget's
 * creator, so both run as the registry row's owner: the service has already
 * checked the caller may act on that row.
 */
const ownerModel = (
  ctx: TrashHandlerContext,
  root: { userId: string; workspaceId: string | null },
) => new WidgetModel(ctx.db, root.userId, root.workspaceId ?? undefined);

export const widgetHandler: TrashHandler = {
  purge: async (ctx, root) => {
    await ownerModel(ctx, root).delete(root.resourceId);
  },
  restore: async (ctx, root) => {
    const restored = await ownerModel(ctx, root).restore(root.resourceId);
    if (!restored) throw new TrashRestoreError('notFound');
  },
  type: 'widget',
};
