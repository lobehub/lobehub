import type { EvalDatasetRecordRefFile } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import type { NewEvalDatasetRecordsItem } from '../../schemas';
import { evalDatasetRecords, files } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class EvalDatasetRecordModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, evalDatasetRecords);

  private filesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files);

  create = async (params: NewEvalDatasetRecordsItem) => {
    const [result] = await this.db
      .insert(evalDatasetRecords)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();
    return result;
  };

  batchCreate = async (params: NewEvalDatasetRecordsItem[]) => {
    const [result] = await this.db
      .insert(evalDatasetRecords)
      .values(
        params.map((item) => ({
          ...item,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
      )
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(evalDatasetRecords)
      .where(and(eq(evalDatasetRecords.id, id), this.ownership()));
  };

  query = async (datasetId: string) => {
    const list = await this.db.query.evalDatasetRecords.findMany({
      where: and(eq(evalDatasetRecords.datasetId, datasetId), this.ownership()),
    });
    const fileList = list.flatMap((item) => item.referenceFiles).filter(Boolean) as string[];

    const fileItems = await this.db
      .select({ fileType: files.fileType, id: files.id, name: files.name })
      .from(files)
      .where(and(inArray(files.id, fileList), this.filesOwnership()));

    return list.map((item) => {
      return {
        ...item,
        referenceFiles: (item.referenceFiles?.map((fileId) => {
          return fileItems.find((file) => file.id === fileId);
        }) || []) as EvalDatasetRecordRefFile[],
      };
    });
  };

  findByDatasetId = async (datasetId: string) => {
    return this.db.query.evalDatasetRecords.findMany({
      where: and(eq(evalDatasetRecords.datasetId, datasetId), this.ownership()),
    });
  };

  findById = async (id: string) => {
    return this.db.query.evalDatasetRecords.findFirst({
      where: and(eq(evalDatasetRecords.id, id), this.ownership()),
    });
  };

  update = async (id: string, value: Partial<NewEvalDatasetRecordsItem>) => {
    return this.db
      .update(evalDatasetRecords)
      .set(value)
      .where(and(eq(evalDatasetRecords.id, id), this.ownership()));
  };
}
