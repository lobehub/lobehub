// Fixture: a join-heavy read stays in the model; only transactional writes move.
import { desc, eq } from 'drizzle-orm';

import { agents, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class TopicListModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async listWithAgent(userId: string) {
    return this.db
      .select({ id: topics.id, agentTitle: agents.title, title: topics.title })
      .from(topics)
      .innerJoin(agents, eq(topics.agentId, agents.id))
      .where(eq(topics.userId, userId))
      .orderBy(desc(topics.updatedAt));
  }
}
