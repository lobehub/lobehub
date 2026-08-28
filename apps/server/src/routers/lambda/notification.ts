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

/**
 * Live transfer requests rendered as inbox cards for this user — incoming
 * (recipient answers) AND outgoing (initiator may withdraw), matching what
 * `Content` renders from `listMine`. Empty in personal mode. Call this BEFORE
 * snapshotting any notification counts: `listPendingForUser` lazily expires
 * overdue transfers (settling their linked rows as read), so counting first
 * would preserve a ghost unread row for a request this very call just expired.
 */
const listLiveTransferCards = async (ctx: {
  serverDB: ConstructorParameters<typeof ResourceTransferRequestModel>[0];
  userId: string;
  workspaceId?: string | null;
}) => {
  if (!ctx.workspaceId) return [];

  const transferModel = new ResourceTransferRequestModel(ctx.serverDB, ctx.workspaceId);
  return transferModel.listPendingForUser(ctx.userId);
};

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
    // row-based counts and count the live request cards themselves —
    // outgoing (withdrawable) cards render in the unread view too, so they
    // count the same as incoming ones.
    const cards = await listLiveTransferCards(ctx);
    const counts = await ctx.notificationModel.getNavigationCounts();
    if (cards.length === 0) return counts;

    const linked = await ctx.notificationModel.countLinkedToTransfers(
      cards.map((request) => request.id),
    );
    // Each live request renders exactly one UNREAD card, replacing
    // its linked row (when one exists) in every tally — a request whose
    // linked row is missing or archived still shows a card, so it must still
    // count, while a linked row that was read is suppressed by the card and
    // must leave the read tally it would otherwise inflate.
    const linkedRead = linked.total - linked.unread;
    const unreadDelta = cards.length - linked.unread;
    const totalDelta = cards.length - linked.total;
    const pending = counts.find((item) => item.category === 'pending');
    if (pending) {
      pending.unreadCount = Math.max(0, pending.unreadCount + unreadDelta);
      pending.readCount = Math.max(0, pending.readCount - linkedRead);
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
    // The header bell must keep prompting while a transfer awaits the user —
    // even if the linked row was read/archived or its delivery failed — so
    // apply the same live-transfer reconciliation as `navigationCounts`.
    const cards = await listLiveTransferCards(ctx);
    const unread = await ctx.notificationModel.getUnreadCount();
    if (cards.length === 0) return unread;

    const linked = await ctx.notificationModel.countLinkedToTransfers(
      cards.map((request) => request.id),
    );
    return Math.max(0, unread + cards.length - linked.unread);
  }),
});

export type NotificationRouter = typeof notificationRouter;
