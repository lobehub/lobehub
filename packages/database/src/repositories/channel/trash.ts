import type { TrashResourceType } from '@lobechat/types';
import { and, eq, inArray, or } from 'drizzle-orm';

import { TrashModel } from '../../models/trash';
import { channelJobs, channelMessages, channels, channelThreads } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { isTrashed, notTrashed, restoreStamp } from '../../utils/softDelete';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { audit, lockChannel } from './transaction';

export type ChannelThreadRestoreResult = 'conflict' | 'missing' | 'parentTrashed' | 'restored';

/** Recycle-bin lifecycle; the trash router authorizes the registry row before calling. */
export class ChannelTrashRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private lockTrashed = async (tx: Transaction, id: string) => {
    const [channel] = await tx
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.id, id),
          isTrashed(channels.isDeleted),
          buildWorkspaceWhere(
            { includeTrashed: true, userId: this.userId, workspaceId: this.workspaceId },
            channels,
          ),
        ),
      )
      .for('update');
    return channel;
  };

  /**
   * A trashed thread in this scope, read under its channel lock so writers keep the
   * channel → child lock order. The channel itself may be live or in the bin.
   */
  private lockTrashedThread = async (tx: Transaction, id: string) => {
    const [found] = await tx
      .select({ channelId: channelThreads.channelId })
      .from(channelThreads)
      .innerJoin(channels, eq(channels.id, channelThreads.channelId))
      .where(
        and(
          eq(channelThreads.id, id),
          isTrashed(channelThreads.isDeleted),
          buildWorkspaceWhere(
            { includeTrashed: true, userId: this.userId, workspaceId: this.workspaceId },
            channels,
          ),
        ),
      );
    if (!found) return;
    const channel = await lockChannel(tx, found.channelId);
    const [thread] = await tx
      .select()
      .from(channelThreads)
      .where(and(eq(channelThreads.id, id), isTrashed(channelThreads.isDeleted)))
      .for('update');
    return thread && { channel, thread };
  };

  private unregister = (
    tx: Transaction,
    id: string,
    resourceType: Extract<TrashResourceType, 'channel' | 'channelThread'> = 'channel',
  ) =>
    new TrashModel(this.db, this.userId, this.workspaceId).removeByResources(
      [{ resourceId: id, resourceType }],
      tx,
    );

  /** Restore access only. Archived branches and cancelled jobs retain their own state. */
  restore = async (id: string): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      if (!(await this.lockTrashed(tx, id))) return false;
      await tx.update(channels).set(restoreStamp()).where(eq(channels.id, id));
      await audit(tx, id, 'restored', id);
      await this.unregister(tx, id);
      return true;
    });

  /**
   * Never erase a live writer's physical lock, even when its channel is in the bin: a channel
   * whose replies are still stopping reports `busy` and stays in the bin for a later purge.
   */
  purge = async (id: string): Promise<'busy' | 'missing' | 'purged'> =>
    this.db.transaction(async (tx) => {
      if (!(await this.lockTrashed(tx, id))) return 'missing';
      const [writer] = await tx
        .select({ id: channelJobs.id })
        .from(channelJobs)
        .where(and(eq(channelJobs.channelId, id), eq(channelJobs.writerHeld, true)))
        .limit(1);
      if (writer) return 'busy';
      // Only Channel-owned records cascade; the referenced Agents, files and topics remain.
      await tx.delete(channels).where(eq(channels.id, id));
      await this.unregister(tx, id);
      return 'purged';
    });

  /**
   * Bring a thread back with its messages and job receipts. Refused while its channel is in
   * the bin (restore that first) or when a newer live thread already hangs off the same
   * root message.
   */
  restoreThread = async (id: string): Promise<ChannelThreadRestoreResult> =>
    this.db.transaction(async (tx) => {
      const locked = await this.lockTrashedThread(tx, id);
      if (!locked) return 'missing';
      const { channel, thread } = locked;
      if (channel.isDeleted) return 'parentTrashed';
      const [live] = await tx
        .select({ id: channelThreads.id })
        .from(channelThreads)
        .where(
          and(
            eq(channelThreads.channelId, thread.channelId),
            eq(channelThreads.rootMessageId, thread.rootMessageId),
            notTrashed(channelThreads.isDeleted),
          ),
        )
        .limit(1);
      if (live) return 'conflict';
      await tx.update(channelThreads).set(restoreStamp()).where(eq(channelThreads.id, id));
      await audit(tx, thread.channelId, 'thread_restored', id);
      await this.unregister(tx, id, 'channelThread');
      return 'restored';
    });

  /**
   * Hard-delete a trashed thread with everything only it owns. The thread foreign keys do
   * not cascade, so its jobs go first, then its messages (attachments cascade), then the
   * thread. A job still holding its writer keeps the whole thread in the bin.
   */
  purgeThread = async (id: string): Promise<'busy' | 'missing' | 'purged'> =>
    this.db.transaction(async (tx) => {
      const locked = await this.lockTrashedThread(tx, id);
      if (!locked) return 'missing';
      const { channelId } = locked.thread;
      const threadMessageIds = tx
        .select({ id: channelMessages.id })
        .from(channelMessages)
        .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.threadId, id)));
      const threadJobs = and(
        eq(channelJobs.channelId, channelId),
        or(eq(channelJobs.threadId, id), inArray(channelJobs.messageId, threadMessageIds)),
      );
      const [writer] = await tx
        .select({ id: channelJobs.id })
        .from(channelJobs)
        .where(and(threadJobs, eq(channelJobs.writerHeld, true)))
        .limit(1);
      if (writer) return 'busy';
      await tx.delete(channelJobs).where(threadJobs);
      await tx
        .delete(channelMessages)
        .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.threadId, id)));
      await tx.delete(channelThreads).where(eq(channelThreads.id, id));
      await audit(tx, channelId, 'thread_purged', id);
      await this.unregister(tx, id, 'channelThread');
      return 'purged';
    });
}
