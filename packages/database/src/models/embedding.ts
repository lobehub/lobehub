import { and, count, eq } from 'drizzle-orm';

import type { NewEmbeddingsItem } from '../schemas';
import { embeddings } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class EmbeddingModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (value: Omit<NewEmbeddingsItem, 'userId'>) => {
    const [item] = await this.db
      .insert(embeddings)
      .values({ ...value, userId: this.userId })
      .returning();

    return item.id as string;
  };

  bulkCreate = async (values: Omit<NewEmbeddingsItem, 'userId'>[]) => {
    return this.db
      .insert(embeddings)
      .values(values.map((item) => ({ ...item, userId: this.userId })))
      .onConflictDoNothing({
        target: [embeddings.chunkId],
      });
  };

  delete = async (id: string) => {
    return this.db
      .delete(embeddings)
      .where(and(eq(embeddings.id, id), eq(embeddings.userId, this.userId)));
  };

  query = async () => {
    return this.db.query.embeddings.findMany({
      where: eq(embeddings.userId, this.userId),
    });
  };

  findById = async (id: string) => {
    return this.db.query.embeddings.findFirst({
      where: and(eq(embeddings.id, id), eq(embeddings.userId, this.userId)),
    });
  };

  countUsage = async (): Promise<number> => {
    const result = await this.db
      .select({
        count: count(),
      })
      .from(embeddings)
      .where(eq(embeddings.userId, this.userId));

    return result[0].count;
  };
}
