import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { NotificationModel } from '@/database/models/notification';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

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
    // The pending category is action-driven, not read-driven: while a
    // transfer request awaits the user, its count must keep prompting even
    // after the linked inbox row was read. Swap the linked rows out of the
    // unread count and count the live incoming requests themselves instead.
    if (!ctx.workspaceId) return ctx.notificationModel.getNavigationCounts();

    // Resolve live requests BEFORE snapshotting counts: `listPendingForUser`
    // lazily expires overdue transfers (settling their linked rows as read),
    // so counting first would preserve a ghost unread row for a request that
    // this very call just expired.
    const transferModel = new ResourceTransferRequestModel(ctx.serverDB, ctx.workspaceId);
    const live = await transferModel.listPendingForUser(ctx.userId);
    const counts = await ctx.notificationModel.getNavigationCounts();
    const incoming = live.filter((request) => request.recipientId === ctx.userId);
    if (incoming.length === 0) return counts;

    const linked = await ctx.notificationModel.countLinkedToTransfers(
      incoming.map((request) => request.id),
    );
    // Each live incoming request renders exactly one card, replacing its
    // linked row (when one exists) in BOTH the unread and total tallies — a
    // request whose linked row is missing or archived still shows a card, so
    // it must still count.
    const unreadDelta = incoming.length - linked.unread;
    const totalDelta = incoming.length - linked.total;
    const pending = counts.find((item) => item.category === 'pending');
    if (pending) {
      pending.unreadCount = Math.max(0, pending.unreadCount + unreadDelta);
      pending.totalCount = Math.max(0, pending.totalCount + totalDelta);
    } else if (unreadDelta > 0 || totalDelta > 0) {
      counts.push({
        category: 'pending',
        readCount: 0,
        totalCount: Math.max(0, totalDelta),
        unreadCount: Math.max(0, unreadDelta),
      });
    }

    return counts;
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
    return ctx.notificationModel.getUnreadCount();
  }),
});

export type NotificationRouter = typeof notificationRouter;
