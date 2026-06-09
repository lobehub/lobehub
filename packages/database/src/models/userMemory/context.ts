import { and, desc, eq } from 'drizzle-orm';

import type { NewUserMemoryContext, UserMemoryContext } from '../../schemas';
import { userMemories, userMemoriesContexts } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class UserMemoryContextModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  private memoryWhere(table: { userId: any }) {
    return eq(table.userId, this.userId);
  }

  create = async (params: Omit<NewUserMemoryContext, 'userId'>) => {
    const [result] = await this.db
      .insert(userMemoriesContexts)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const context = await tx.query.userMemoriesContexts.findFirst({
        where: and(eq(userMemoriesContexts.id, id), this.memoryWhere(userMemoriesContexts)),
      });

      if (!context) {
        return { success: false };
      }

      // Delete associated user memories if any
      const memoryIds = Array.isArray(context.userMemoryIds)
        ? (context.userMemoryIds as string[])
        : [];

      if (memoryIds.length > 0) {
        for (const memoryId of memoryIds) {
          await tx
            .delete(userMemories)
            .where(and(eq(userMemories.id, memoryId), this.memoryWhere(userMemories)));
        }
      }

      // Delete the context entry
      await tx
        .delete(userMemoriesContexts)
        .where(and(eq(userMemoriesContexts.id, id), this.memoryWhere(userMemoriesContexts)));

      return { success: true };
    });
  };

  deleteAll = async () => {
    return this.db.delete(userMemoriesContexts).where(this.memoryWhere(userMemoriesContexts));
  };

  query = async (limit = 50) => {
    return this.db.query.userMemoriesContexts.findMany({
      limit,
      orderBy: [desc(userMemoriesContexts.createdAt)],
      where: this.memoryWhere(userMemoriesContexts),
    });
  };

  findById = async (id: string) => {
    return this.db.query.userMemoriesContexts.findFirst({
      where: and(eq(userMemoriesContexts.id, id), this.memoryWhere(userMemoriesContexts)),
    });
  };

  update = async (id: string, value: Partial<UserMemoryContext>) => {
    return this.db
      .update(userMemoriesContexts)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(userMemoriesContexts.id, id), this.memoryWhere(userMemoriesContexts)));
  };
}
