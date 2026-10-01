import type { NotificationModel } from '@/database/models/notification';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import type { LobeChatDatabase } from '@/database/type';

export type NotificationNavigationCount = Awaited<
  ReturnType<NotificationModel['getNavigationCounts']>
>[number];

type TransferCard = Awaited<ReturnType<ResourceTransferRequestModel['listPendingForUser']>>[number];

export interface InboxCountContext {
  notificationModel: NotificationModel;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Live transfer requests rendered as inbox cards for this user — incoming
 * (recipient answers) AND outgoing (initiator may withdraw), matching what
 * `Content` renders from `listMine`. Empty in personal mode. Call this BEFORE
 * snapshotting any notification counts: `listPendingForUser` lazily expires
 * overdue transfers (settling their linked rows as read), so counting first
 * would preserve a ghost unread row for a request this very call just expired.
 */
export const listLiveTransferCards = async (ctx: InboxCountContext): Promise<TransferCard[]> => {
  if (!ctx.workspaceId) return [];

  const transferModel = new ResourceTransferRequestModel(ctx.serverDB, ctx.workspaceId);
  return transferModel.listPendingForUser(ctx.userId);
};

/**
 * Unread count for the header bell, reconciled against live transfer requests.
 *
 * A pending transfer keeps prompting even if its linked inbox row was
 * read/archived or its delivery failed, so the raw row count undercounts the
 * inbox and the two numbers would disagree. Shared by every transport (the
 * tRPC router the in-app bell calls and the REST route behind the SDK) so the
 * reconciliation cannot drift between them.
 */
export const resolveUnreadCount = async (ctx: InboxCountContext): Promise<number> => {
  const cards = await listLiveTransferCards(ctx);
  const unread = await ctx.notificationModel.getUnreadCount();
  if (cards.length === 0) return unread;

  const linked = await ctx.notificationModel.countLinkedToTransfers(
    cards.map((request) => request.id),
  );
  return Math.max(0, unread + cards.length - linked.unread);
};

/**
 * Per-category navigation counts, reconciled against live transfer requests.
 *
 * The pending category is action-driven, not read-driven: while a transfer
 * request awaits the user, its count must keep prompting even after the linked
 * inbox row was read. Swap the linked rows out of the row-based counts and
 * count the live request cards themselves — outgoing (withdrawable) cards
 * render in the unread view too, so they count the same as incoming ones.
 */
export const resolveNavigationCounts = async (
  ctx: InboxCountContext,
): Promise<NotificationNavigationCount[]> => {
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
};
