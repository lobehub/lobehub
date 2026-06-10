import { and, eq } from 'drizzle-orm';

import type { NewEvaluationRecordsItem } from '../../schemas';
import { evaluationRecords } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class EvaluationRecordModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, evaluationRecords);

  create = async (params: NewEvaluationRecordsItem) => {
    const [result] = await this.db
      .insert(evaluationRecords)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();
    return result;
  };

  batchCreate = async (params: NewEvaluationRecordsItem[]) => {
    return this.db
      .insert(evaluationRecords)
      .values(
        params.map((item) => ({
          ...item,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
      )
      .returning();
  };

  delete = async (id: string) => {
    return this.db
      .delete(evaluationRecords)
      .where(and(eq(evaluationRecords.id, id), this.ownership()));
  };

  query = async (reportId: string) => {
    return this.db.query.evaluationRecords.findMany({
      where: and(eq(evaluationRecords.evaluationId, reportId), this.ownership()),
    });
  };

  findById = async (id: string) => {
    return this.db.query.evaluationRecords.findFirst({
      where: and(eq(evaluationRecords.id, id), this.ownership()),
    });
  };

  findByEvaluationId = async (evaluationId: string) => {
    return this.db.query.evaluationRecords.findMany({
      where: and(eq(evaluationRecords.evaluationId, evaluationId), this.ownership()),
    });
  };

  update = async (id: string, value: Partial<NewEvaluationRecordsItem>) => {
    return this.db
      .update(evaluationRecords)
      .set(value)
      .where(and(eq(evaluationRecords.id, id), this.ownership()));
  };
}
