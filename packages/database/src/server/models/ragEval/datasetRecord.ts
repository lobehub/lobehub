import type { EvalDatasetRecordRefFile } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import type { NewEvalDatasetRecordsItem } from '../../../schemas';
import { evalDatasetRecords, files } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';

export class EvalDatasetRecordModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: NewEvalDatasetRecordsItem) => {
    const [result] = await this.db
      .insert(evalDatasetRecords)
      .values({ ...params, userId: this.userId })
      .returning();
    return result;
  };

  batchCreate = async (params: NewEvalDatasetRecordsItem[]) => {
    const [result] = await this.db
      .insert(evalDatasetRecords)
      .values(params.map((item) => ({ ...item, userId: this.userId })))
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(evalDatasetRecords)
      .where(and(eq(evalDatasetRecords.id, id), eq(evalDatasetRecords.userId, this.userId)));
  };

  query = async (datasetId: string) => {
    const list = await this.db.query.evalDatasetRecords.findMany({
      where: and(
        eq(evalDatasetRecords.datasetId, datasetId),
        eq(evalDatasetRecords.userId, this.userId),
      ),
    });
    const fileList = list.flatMap((item) => item.referenceFiles).filter(Boolean) as string[];

    const fileItems = await this.db
      .select({ fileType: files.fileType, id: files.id, name: files.name })
      .from(files)
      .where(and(inArray(files.id, fileList), eq(files.userId, this.userId)));

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
      where: and(
        eq(evalDatasetRecords.datasetId, datasetId),
        eq(evalDatasetRecords.userId, this.userId),
      ),
    });
  };

  findById = async (id: string) => {
    return this.db.query.evalDatasetRecords.findFirst({
      where: and(eq(evalDatasetRecords.id, id), eq(evalDatasetRecords.userId, this.userId)),
    });
  };

  update = async (id: string, value: Partial<NewEvalDatasetRecordsItem>) => {
    return this.db
      .update(evalDatasetRecords)
      .set(value)
      .where(and(eq(evalDatasetRecords.id, id), eq(evalDatasetRecords.userId, this.userId)));
  };
}
