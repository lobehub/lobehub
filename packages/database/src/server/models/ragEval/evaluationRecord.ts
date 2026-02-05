import { and, eq } from 'drizzle-orm';

import type {NewEvaluationRecordsItem } from '../../../schemas';
import { evaluationRecords } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';

export class EvaluationRecordModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: NewEvaluationRecordsItem) => {
    const [result] = await this.db
      .insert(evaluationRecords)
      .values({ ...params, userId: this.userId })
      .returning();
    return result;
  };

  batchCreate = async (params: NewEvaluationRecordsItem[]) => {
    return this.db
      .insert(evaluationRecords)
      .values(params.map((item) => ({ ...item, userId: this.userId })))
      .returning();
  };

  delete = async (id: number) => {
    return this.db
      .delete(evaluationRecords)
      .where(and(eq(evaluationRecords.id, id), eq(evaluationRecords.userId, this.userId)));
  };

  query = async (reportId: number) => {
    return this.db.query.evaluationRecords.findMany({
      where: and(
        eq(evaluationRecords.evaluationId, reportId),
        eq(evaluationRecords.userId, this.userId),
      ),
    });
  };

  findById = async (id: number) => {
    return this.db.query.evaluationRecords.findFirst({
      where: and(eq(evaluationRecords.id, id), eq(evaluationRecords.userId, this.userId)),
    });
  };

  findByEvaluationId = async (evaluationId: number) => {
    return this.db.query.evaluationRecords.findMany({
      where: and(
        eq(evaluationRecords.evaluationId, evaluationId),
        eq(evaluationRecords.userId, this.userId),
      ),
    });
  };

  update = async (id: number, value: Partial<NewEvaluationRecordsItem>) => {
    return this.db
      .update(evaluationRecords)
      .set(value)
      .where(and(eq(evaluationRecords.id, id), eq(evaluationRecords.userId, this.userId)));
  };
}
