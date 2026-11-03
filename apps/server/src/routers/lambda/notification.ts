import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { NotificationModel } from '@/database/models/notification';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  resolveNavigationCounts,
  resolveUnreadCount,
} from '@/server/services/notification/inboxCounts';

const notificationProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      // Scope the inbox to the request context: workspace mode only sees that
      // workspace's notifications, personal mode only sees personal ones
      // (`workspace_id IS NULL`) — the two contexts never leak into each other.
      notificationModel: new NotificationModel(ctx.serverDB, ctx.userId, {
        workspaceId: ctx.workspaceId ?? null,
      }),
    },
  });
});
const notificationWriteProcedure = notificationProcedure.use(
  withScopedPermission('message:create'),
);

export const notificationRouter = router({
  archive: notificationWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.notificationModel.archive(input.id);
    }),

  archiveAll: notificationWriteProcedure.mutation(async ({ ctx }) => {
    return ctx.notificationModel.archiveAll();
  }),

  navigationCounts: notificationProcedure.query(async ({ ctx }) => {
    return resolveNavigationCounts(ctx);
  }),

  list: notificationProcedure
    .input(
      z.object({
        category: z.string().optional(),
        cursor: z.string().optional(),
        isRead: z.boolean().optional(),
        limit: z.number().min(1).max(50).default(20),
        unreadOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.notificationModel.list(input);
    }),

  markAllAsRead: notificationWriteProcedure.mutation(async ({ ctx }) => {
    return ctx.notificationModel.markAllAsRead();
  }),

  markAsRead: notificationWriteProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.notificationModel.markAsRead(input.ids);
    }),

  unreadCount: notificationProcedure.query(async ({ ctx }) => {
    return resolveUnreadCount(ctx);
  }),
});

export type NotificationRouter = typeof notificationRouter;
