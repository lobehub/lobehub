// Fixture: a root row, its owned child rows and its event log are one aggregate.
import { eq } from 'drizzle-orm';

import { goalEvents, goalNodes, messagePlugins, messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class GoalNodeModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async updateStatus(id: string, status: string) {
    return this.db.transaction(async (tx) => {
      await tx.update(goalNodes).set({ status }).where(eq(goalNodes.id, id));
      await tx.insert(goalEvents).values({ nodeId: id, type: 'status', payload: { status } });
    });
  }

  async createToolMessage(content: string, toolCallId: string) {
    return this.db.transaction(async (tx) => {
      const [message] = await tx.insert(messages).values({ content, role: 'tool' }).returning();
      await tx.insert(messagePlugins).values({ id: message.id, toolCallId });
      return message;
    });
  }
}
