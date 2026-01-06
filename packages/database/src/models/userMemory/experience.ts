import { and, desc, eq } from 'drizzle-orm';

import {
  NewUserMemoryExperience,
  UserMemoryExperience,
  userMemories,
  userMemoriesExperiences,
} from '../../schemas';
import { LobeChatDatabase } from '../../type';

export class UserMemoryExperienceModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewUserMemoryExperience, 'userId'>) => {
    const [result] = await this.db
      .insert(userMemoriesExperiences)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const experience = await tx.query.userMemoriesExperiences.findFirst({
        where: and(
          eq(userMemoriesExperiences.id, id),
          eq(userMemoriesExperiences.userId, this.userId),
        ),
      });

      if (!experience || !experience.userMemoryId) {
        return { success: false };
      }

      // Delete the base user memory (cascade will handle the experience)
      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, experience.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return { success: true };
    });
  };

  deleteAll = async () => {
    return this.db
      .delete(userMemoriesExperiences)
      .where(eq(userMemoriesExperiences.userId, this.userId));
  };

  query = async (limit = 50) => {
    return this.db.query.userMemoriesExperiences.findMany({
      limit,
      orderBy: [desc(userMemoriesExperiences.createdAt)],
      where: eq(userMemoriesExperiences.userId, this.userId),
    });
  };

  findById = async (id: string) => {
    return this.db.query.userMemoriesExperiences.findFirst({
      where: and(
        eq(userMemoriesExperiences.id, id),
        eq(userMemoriesExperiences.userId, this.userId),
      ),
    });
  };

  update = async (id: string, value: Partial<UserMemoryExperience>) => {
    return this.db
      .update(userMemoriesExperiences)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(eq(userMemoriesExperiences.id, id), eq(userMemoriesExperiences.userId, this.userId)),
      );
  };
}
