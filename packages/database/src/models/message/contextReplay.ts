import type { ContextReplaySnapshot } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { messageContextSnapshots, messages } from '../../schemas';
import { MessageScope } from './scope';

/** Author-only storage; never joined into ordinary message queries. */
export class MessageContextReplays extends MessageScope {
  getContextReplays = async (ids: string[]): Promise<Record<string, ContextReplaySnapshot>> => {
    if (!ids.length) return {};
    const rows = await this.db
      .select({ id: messages.id, snapshot: messageContextSnapshots.snapshot })
      .from(messageContextSnapshots)
      .innerJoin(messages, eq(messages.id, messageContextSnapshots.messageId))
      .where(
        and(
          this.ownership(),
          inArray(messages.id, ids),
          eq(messageContextSnapshots.userId, this.userId),
        ),
      );
    return Object.fromEntries(rows.map((row) => [row.id, row.snapshot]));
  };

  commitContextReplay = async (
    id: string,
    snapshot: ContextReplaySnapshot,
  ): Promise<ContextReplaySnapshot> => {
    if (snapshot.invocationId !== id)
      throw new Error('Context snapshot belongs to another invocation');
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            this.ownership(),
            eq(messages.id, id),
            eq(messages.userId, this.userId),
            eq(messages.role, 'assistant'),
          ),
        )
        .for('update');
      if (!message) throw new Error('Context snapshot message is unavailable');
      const [existing] = await tx
        .select()
        .from(messageContextSnapshots)
        .where(eq(messageContextSnapshots.messageId, id));
      if (existing) return existing.snapshot;
      const committed = { ...snapshot, createdBy: this.userId };
      await tx.insert(messageContextSnapshots).values({
        messageId: id,
        userId: this.userId,
        workspaceId: this.workspaceId,
        snapshot: committed,
      });
      return committed;
    });
  };
}
