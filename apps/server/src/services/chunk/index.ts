import { type LobeChatDatabase } from '@lobechat/database';

import { FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE, MAX_FILE_PARSE_SIZE } from '@/const/file';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { getChunkingLoaderType } from '@/libs/document-loaders/loaderType';
import { type ChunkContentParams } from '@/server/modules/ContentChunk';
import { ContentChunk } from '@/server/modules/ContentChunk';
import {
  admitFileTask,
  type FileTaskRef,
  prepareFileTaskTrigger,
  releaseFileTaskAdmission,
  triggerFileTask,
} from '@/server/services/fileTaskAdmission';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

export class ChunkService {
  private userId: string;
  private workspaceId?: string;
  private chunkClient: ContentChunk;
  private fileModel: FileModel;
  private asyncTaskModel: AsyncTaskModel;

  constructor(serverDB: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.workspaceId = workspaceId;

    this.chunkClient = new ContentChunk();

    this.fileModel = new FileModel(serverDB, userId, workspaceId);
    this.asyncTaskModel = new AsyncTaskModel(serverDB, userId, workspaceId);
  }

  async chunkContent(params: ChunkContentParams) {
    return this.chunkClient.chunkContent(params);
  }

  /**
   * @param options.inheritedSlot the caller is the parse task of this file and keeps holding its
   *   slot while embedding runs, so one file counts once and can never wait on itself
   */
  async asyncEmbeddingFileChunks(fileId: string, options?: { inheritedSlot?: boolean }) {
    const result = await this.fileModel.findById(fileId);

    if (!result) return;

    // 1. create a asyncTaskId
    const asyncTaskId = await this.asyncTaskModel.create({
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.Embedding,
    });

    await this.fileModel.update(fileId, { embeddingTaskId: asyncTaskId });

    const task: FileTaskRef = {
      fileId,
      kind: 'embedding',
      taskId: asyncTaskId,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
    let admissionScope: string | undefined;

    // trigger embedding task asynchronously
    try {
      if (!options?.inheritedSlot) {
        const admission = await admitFileTask(task, this.asyncTaskModel);
        if (admission.queued) return asyncTaskId;
        admissionScope = admission.admissionScope;
      }

      await triggerFileTask({ ...task, admissionScope });
    } catch (e) {
      console.error('[embeddingFileChunks] error:', e);
      await releaseFileTaskAdmission(admissionScope, asyncTaskId);

      // The async procedure ran and rejected the task itself (for example, a business
      // middleware recorded that the vector quota is full). Keep that error: the generic
      // APP_URL hint below is only right when the request never reached the server.
      const task = await this.asyncTaskModel.findById(asyncTaskId);
      if (task?.status === AsyncTaskStatus.Error) return asyncTaskId;

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

    // No chunking loader can parse this format (e.g. `.dwg`): creating a task would only
    // surface a retryable "Chunking failed" for a limitation retrying cannot fix.
    if (!getChunkingLoaderType(result.name)) return;

    // 1. create a asyncTaskId
    const asyncTaskId = await this.asyncTaskModel.create({
      status:
        result.size > MAX_FILE_PARSE_SIZE ? AsyncTaskStatus.Error : AsyncTaskStatus.Processing,
      type: AsyncTaskType.Chunking,
    });

    await this.fileModel.update(fileId, { chunkTaskId: asyncTaskId });

    if (result.size > MAX_FILE_PARSE_SIZE) {
      await this.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.FileTooLargeToParse,
          FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE,
        ),
        status: AsyncTaskStatus.Error,
      });

      return asyncTaskId;
    }

    const task: FileTaskRef = {
      fileId,
      kind: 'parse',
      taskId: asyncTaskId,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
    let admissionScope: string | undefined;

    const recordTriggerError = async (e: unknown) => {
      console.error('[ParseFileToChunks] error:', e);
      await releaseFileTaskAdmission(admissionScope, asyncTaskId);

      await this.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    };

    let sendTrigger: () => Promise<unknown>;
    try {
      const admission = await admitFileTask(task, this.asyncTaskModel);
      if (admission.queued) return asyncTaskId;
      admissionScope = admission.admissionScope;
      sendTrigger = await prepareFileTaskTrigger({ ...task, admissionScope });
    } catch (e) {
      await recordTriggerError(e);
      return asyncTaskId;
    }

    // trigger parse file task asynchronously
    sendTrigger().catch(recordTriggerError);

    return asyncTaskId;
  }
}
