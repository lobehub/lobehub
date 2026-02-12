import { and, desc, eq } from 'drizzle-orm';

import type { NewUserMemoryPreference, UserMemoryPreference } from '../../schemas';
import { userMemories, userMemoriesPreferences } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class UserMemoryPreferenceModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewUserMemoryPreference, 'userId'>) => {
    const [result] = await this.db
      .insert(userMemoriesPreferences)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const preference = await tx.query.userMemoriesPreferences.findFirst({
        where: and(
          eq(userMemoriesPreferences.id, id),
          eq(userMemoriesPreferences.userId, this.userId),
        ),
      });

      if (!preference || !preference.userMemoryId) {
        return { success: false };
      }

      // Delete the base user memory (cascade will handle the preference)
      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, preference.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return { success: true };
    });
  };

  deleteAll = async () => {
    return this.db
      .delete(userMemoriesPreferences)
      .where(eq(userMemoriesPreferences.userId, this.userId));
  };

  query = async (limit = 50) => {
    return this.db.query.userMemoriesPreferences.findMany({
      limit,
      orderBy: [desc(userMemoriesPreferences.createdAt)],
      where: eq(userMemoriesPreferences.userId, this.userId),
    });
  };

  findById = async (id: string) => {
    return this.db.query.userMemoriesPreferences.findFirst({
      where: and(
        eq(userMemoriesPreferences.id, id),
        eq(userMemoriesPreferences.userId, this.userId),
      ),
    });
  };

  update = async (id: string, value: Partial<UserMemoryPreference>) => {
    return this.db
      .update(userMemoriesPreferences)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(eq(userMemoriesPreferences.id, id), eq(userMemoriesPreferences.userId, this.userId)),
      );
  };
}
