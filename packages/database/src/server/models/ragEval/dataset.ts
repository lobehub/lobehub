import type { RAGEvalDataSetItem } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import type { NewEvalDatasetsItem } from '../../../schemas';
import { evalDatasets } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';

export class EvalDatasetModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: NewEvalDatasetsItem) => {
    const [result] = await this.db
      .insert(evalDatasets)
      .values({ ...params, userId: this.userId })
      .returning();
    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(evalDatasets)
      .where(and(eq(evalDatasets.id, id), eq(evalDatasets.userId, this.userId)));
  };

  query = async (knowledgeBaseId: string): Promise<RAGEvalDataSetItem[]> => {
    return this.db
      .select({
        createdAt: evalDatasets.createdAt,
        description: evalDatasets.description,
        id: evalDatasets.id,
        name: evalDatasets.name,
        updatedAt: evalDatasets.updatedAt,
      })
      .from(evalDatasets)
      .where(
        and(
          eq(evalDatasets.userId, this.userId),
          eq(evalDatasets.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .orderBy(desc(evalDatasets.createdAt));
  };

  findById = async (id: string) => {
    return this.db.query.evalDatasets.findFirst({
      where: and(eq(evalDatasets.id, id), eq(evalDatasets.userId, this.userId)),
    });
  };

  update = async (id: string, value: Partial<NewEvalDatasetsItem>) => {
    return this.db
      .update(evalDatasets)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(evalDatasets.id, id), eq(evalDatasets.userId, this.userId)));
  };
}
