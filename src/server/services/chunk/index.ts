import { type LobeChatDatabase } from '@lobechat/database';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { type ChunkContentParams } from '@/server/modules/ContentChunk';
import { ContentChunk } from '@/server/modules/ContentChunk';
import { createAsyncCaller } from '@/server/routers/async';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

export class ChunkService {
  private userId: string;
  private chunkClient: ContentChunk;
  private fileModel: FileModel;
  private asyncTaskModel: AsyncTaskModel;

  constructor(serverDB: LobeChatDatabase, userId: string) {
    this.userId = userId;

    this.chunkClient = new ContentChunk();

    this.fileModel = new FileModel(serverDB, userId);
    this.asyncTaskModel = new AsyncTaskModel(serverDB, userId);
  }

  async chunkContent(params: ChunkContentParams) {
    return this.chunkClient.chunkContent(params);
  }

  async asyncEmbeddingFileChunks(fileId: string) {
    const result = await this.fileModel.findById(fileId);

    if (!result) return;

    // 1. create a asyncTaskId
    const asyncTaskId = await this.asyncTaskModel.create({
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.Embedding,
    });

    await this.fileModel.update(fileId, { embeddingTaskId: asyncTaskId });

    // Async router will read keyVaults from DB, no need to pass jwtPayload
    const asyncCaller = await createAsyncCaller({ userId: this.userId });

    // trigger embedding task asynchronously
    try {
      await asyncCaller.file.embeddingChunks({ fileId, taskId: asyncTaskId });
    } catch (e) {
      console.error('[embeddingFileChunks] error:', e);

      await this.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    }

    return asyncTaskId;
  }

  /**
   * parse file to chunks with async task
   */
  async asyncParseFileToChunks(fileId: string, skipExist?: boolean) {
    const result = await this.fileModel.findById(fileId);

    if (!result) return;

    // skip if already exist chunk tasks
    if (skipExist && result.chunkTaskId) return;

    // 1. create a asyncTaskId
    const asyncTaskId = await this.asyncTaskModel.create({
      status: AsyncTaskStatus.Processing,
      type: AsyncTaskType.Chunking,
    });

    await this.fileModel.update(fileId, { chunkTaskId: asyncTaskId });

    // Async router will read keyVaults from DB, no need to pass jwtPayload
    const asyncCaller = await createAsyncCaller({ userId: this.userId });

    // trigger parse file task asynchronously
    asyncCaller.file.parseFileToChunks({ fileId: fileId, taskId: asyncTaskId }).catch(async (e) => {
      console.error('[ParseFileToChunks] error:', e);

      await this.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    });

    return asyncTaskId;
  }
}
