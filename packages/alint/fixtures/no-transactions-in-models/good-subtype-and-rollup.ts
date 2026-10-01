// Fixture: a subtype row with its base row, and a rollup on the parent.
import { eq, sql } from 'drizzle-orm';

import { messages, topics, userMemories, userMemoriesPreferences } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class UserMemoryPreferenceModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async delete(id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(userMemoriesPreferences)
        .where(eq(userMemoriesPreferences.id, id))
        .returning();
      if (row) await tx.delete(userMemories).where(eq(userMemories.id, row.userMemoryId));
    });
  }

  async updateMessage(id: string, topicId: string, content: string) {
    return this.db.transaction(async (tx) => {
      await tx.update(messages).set({ content }).where(eq(messages.id, id));
      await tx
        .update(topics)
        .set({ messageCount: sql`(select count(*) from messages where topic_id = ${topicId})` })
        .where(eq(topics.id, topicId));
    });
  }
}
