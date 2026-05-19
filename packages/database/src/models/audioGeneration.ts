import { and, desc, eq } from 'drizzle-orm';

import type { AudioGenerationSelectItem, NewAudioGenerationItem } from '../schemas/audio';
import { audioGenerations } from '../schemas/audio';
import type { LobeChatDatabase } from '../type';

export class AudioGenerationModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Create a new audio generation record
   */
  async create(value: Omit<NewAudioGenerationItem, 'userId'>): Promise<AudioGenerationSelectItem> {
    const [result] = await this.db
      .insert(audioGenerations)
      .values({
        ...value,
        userId: this.userId,
      })
      .returning();

    return result;
  }

  /**
   * Find audio generation by ID
   */
  async findById(id: string): Promise<AudioGenerationSelectItem | undefined> {
    return this.db.query.audioGenerations.findFirst({
      where: and(
        eq(audioGenerations.id, id),
        eq(audioGenerations.userId, this.userId),
      ),
    });
  }

  /**
   * Find audio generation by Suno task ID
   */
  async findByTaskId(taskId: string): Promise<AudioGenerationSelectItem | undefined> {
    return this.db.query.audioGenerations.findFirst({
      where: and(
        eq(audioGenerations.taskId, taskId),
        eq(audioGenerations.userId, this.userId),
      ),
    });
  }

  /**
   * Update audio generation record
   */
  async update(
    id: string,
    value: Partial<NewAudioGenerationItem>,
  ): Promise<void> {
    await this.db
      .update(audioGenerations)
      .set({
        ...value,
        updatedAt: new Date(),
      })
      .where(and(
        eq(audioGenerations.id, id),
        eq(audioGenerations.userId, this.userId),
      ));
  }

  /**
   * Delete audio generation record
   */
  async delete(id: string): Promise<void> {
    await this.db
      .delete(audioGenerations)
      .where(and(
        eq(audioGenerations.id, id),
        eq(audioGenerations.userId, this.userId),
      ));
  }

  /**
   * List user's audio generations with pagination
   */
  async listByUser(limit: number = 10, offset: number = 0): Promise<{
    data: AudioGenerationSelectItem[];
    total: number;
  }> {
    const data = await this.db.query.audioGenerations.findMany({
      where: eq(audioGenerations.userId, this.userId),
      orderBy: desc(audioGenerations.createdAt),
      limit,
      offset,
    });

    // Get total count
    const [{ count }] = await this.db
      .select({ count: this.db.sql<number>`count(*)` })
      .from(audioGenerations)
      .where(eq(audioGenerations.userId, this.userId));

    return {
      data,
      total: count || 0,
    };
  }

  /**
   * Get all pending/processing tasks for user
   */
  async getActiveTasks(): Promise<AudioGenerationSelectItem[]> {
    return this.db.query.audioGenerations.findMany({
      where: and(
        eq(audioGenerations.userId, this.userId),
        this.db.sql`${audioGenerations.status} IN ('pending', 'processing')`,
      ),
      orderBy: desc(audioGenerations.createdAt),
    });
  }
}
