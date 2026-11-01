import { and, count, eq } from 'drizzle-orm';

import type { NewEmbeddingsItem } from '../schemas';
import { embeddings } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export class EmbeddingModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, embeddings);

  create = async (value: Omit<NewEmbeddingsItem, 'userId'>) => {
    const [item] = await this.db
      .insert(embeddings)
      .values({ ...value, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();

    return item.id as string;
  };

  bulkCreate = async (values: Omit<NewEmbeddingsItem, 'userId'>[]) => {
    return this.db
      .insert(embeddings)
      .values(
        values.map((item) => ({
          ...item,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [embeddings.chunkId],
      });
  };

  delete = async (id: string) => {
    return this.db.delete(embeddings).where(and(eq(embeddings.id, id), this.ownership()));
  };

  query = async () => {
    return this.db.query.embeddings.findMany({
      where: this.ownership(),
    });
  };

  findById = async (id: string) => {
    return this.db.query.embeddings.findFirst({
      where: and(eq(embeddings.id, id), this.ownership()),
    });
  };

  countUsage = async (): Promise<number> => {
    const result = await this.db
      .select({
        count: count(),
      })
      .from(embeddings)
      .where(this.ownership());

    return result[0].count;
  };
}
