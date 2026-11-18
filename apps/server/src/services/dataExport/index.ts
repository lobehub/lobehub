import { BRANDING_NAME } from '@lobechat/business-const';
import type {
  DataExportTaskMetadata,
  DataExportView,
  ImportPgDataStructure,
} from '@lobechat/types';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@lobechat/types';
import dayjs from 'dayjs';

import { notifyDataExportResult } from '@/business/server/data-export/notifyDataExportResult';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { DrizzleMigrationModel } from '@/database/models/drizzleMigration';
import { DataExporterRepos } from '@/database/repositories/dataExporter';
import type { AsyncTaskSelectItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

/**
 * An export still queued or running after this long is shown as failed. The
 * background run is capped by the host's function timeout well below this, so
 * such a task was lost (crashed instance, dropped hand-off) and will never end.
 */
export const DATA_EXPORT_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * A run gives up, and reports the failure, before the async route's 800s
 * function limit would kill it silently and leave the user without a result.
 */
export const DATA_EXPORT_RUN_DEADLINE_MS = 12 * 60 * 1000;

/**
 * Run `work` until it settles or `ms` passes. On the deadline the signal
 * aborts, so work still going stops instead of finishing after its task was
 * already reported as failed.
 */
const withDeadline = async <T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Data export did not finish within ${ms}ms`);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
};

/** Rows exported per table query, matching the former synchronous export. */
const EXPORT_PAGE_CONCURRENCY = 5;

/** How long a download link stays valid; the page asks for a new one per click. */
const DOWNLOAD_URL_EXPIRES_IN_SECONDS = 10 * 60;

const isStale = (task: AsyncTaskSelectItem, now = Date.now()) =>
  now - task.createdAt.getTime() > DATA_EXPORT_STALE_AFTER_MS;

export const toDataExportView = (task: AsyncTaskSelectItem): DataExportView => {
  const metadata = (task.metadata ?? {}) as DataExportTaskMetadata;
  const base = { createdAt: task.createdAt, id: task.id };

  if (task.status === AsyncTaskStatus.Success && metadata.fileKey) {
    return {
      ...base,
      completedAt: task.updatedAt,
      fileSize: metadata.fileSize,
      status: 'success',
    };
  }

  if (task.status === AsyncTaskStatus.Pending || task.status === AsyncTaskStatus.Processing) {
    return { ...base, status: isStale(task) ? 'error' : 'processing' };
  }

  return { ...base, status: 'error' };
};

/** Same name the browser download used before exports moved to the background. */
export const getDataExportFileName = (createdAt: Date) =>
  `${dayjs(createdAt).format('YYYY-MM-DD-HH-mm')}_${BRANDING_NAME}-data.json`;

/**
 * Builds a full data export into a stored file, so a large account no longer
 * has to keep a browser request open until every table is read.
 *
 * Only the newest export is kept: once a new file is stored, older export
 * files and their tasks are removed.
 */
export class DataExportService {
  private db: LobeChatDatabase;
  private taskModel: AsyncTaskModel;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.taskModel = new AsyncTaskModel(db, userId, workspaceId);
  }

  getLatest = async (): Promise<DataExportView | null> => {
    const [latest] = await this.taskModel.findAllByType(AsyncTaskType.DataExport);
    return latest ? toDataExportView(latest) : null;
  };

  /** The running export, if any; a stale one does not count. */
  findRunning = async (): Promise<AsyncTaskSelectItem | undefined> => {
    const tasks = await this.taskModel.findAllByType(AsyncTaskType.DataExport);
    return tasks.find((task) => toDataExportView(task).status === 'processing');
  };

  createTask = async (): Promise<string> =>
    this.taskModel.create({
      metadata: {} satisfies DataExportTaskMetadata,
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.DataExport,
    });

  /** Mark a task that was never picked up as failed; a claimed one is left to its runner. */
  failUnclaimed = async (taskId: string, reason: string) => {
    const task = await this.taskModel.findById(taskId);
    if (task?.status !== AsyncTaskStatus.Pending) return;

    await this.taskModel.update(taskId, {
      error: new AsyncTaskError(AsyncTaskErrorType.TaskTriggerError, reason),
      status: AsyncTaskStatus.Error,
    });
    await this.notify(taskId, 'error');
  };

  /** Build the export file for a queued task. Runs at most once per task. */
  run = async (taskId: string): Promise<void> => {
    if (!(await this.taskModel.claimPending(taskId))) return;

    const startedAt = Date.now();
    const fileService = new FileService(this.db, this.userId, this.workspaceId);

    try {
      const { fileKey, fileSize } = await withDeadline(
        (signal) => this.buildFile(taskId, fileService, signal),
        DATA_EXPORT_RUN_DEADLINE_MS,
      );

      await this.taskModel.update(taskId, {
        duration: Date.now() - startedAt,
        metadata: { fileKey, fileSize } satisfies DataExportTaskMetadata,
        status: AsyncTaskStatus.Success,
      });
    } catch (error) {
      console.error('[data-export] export %s failed: %O', taskId, error);
      await this.taskModel.update(taskId, {
        duration: Date.now() - startedAt,
        error: new AsyncTaskError(
          AsyncTaskErrorType.ServerError,
          error instanceof Error ? error.message : String(error),
        ),
        status: AsyncTaskStatus.Error,
      });
      await this.notify(taskId, 'error');
      return;
    }

    await this.removeOlderExports(taskId, fileService);
    await this.notify(taskId, 'success');
  };

  getDownloadUrl = async (taskId: string): Promise<{ fileName: string; url: string }> => {
    const task = await this.taskModel.findById(taskId);
    const fileKey = (task?.metadata as DataExportTaskMetadata | undefined)?.fileKey;

    if (
      !task ||
      task.type !== AsyncTaskType.DataExport ||
      task.status !== AsyncTaskStatus.Success ||
      !fileKey
    ) {
      throw new Error('Data export not found');
    }

    const fileName = getDataExportFileName(task.createdAt);
    const url = await new FileService(this.db, this.userId, this.workspaceId).createDownloadUrl(
      fileKey,
      fileName,
      DOWNLOAD_URL_EXPIRES_IN_SECONDS,
    );

    return { fileName, url };
  };

  private buildFile = async (taskId: string, fileService: FileService, signal: AbortSignal) => {
    const data = await new DataExporterRepos(this.db, this.userId, this.workspaceId).export(
      EXPORT_PAGE_CONCURRENCY,
    );
    const schemaHash = await new DrizzleMigrationModel(this.db).getLatestMigrationHash();
    signal.throwIfAborted();
    const content: ImportPgDataStructure = { data, mode: 'postgres', schemaHash };
    const buffer = Buffer.from(JSON.stringify(content));

    const fileKey = `exports/${this.workspaceId ?? this.userId}/${taskId}.json`;
    // A full account dump is only ever served through short-lived signed links.
    await fileService.uploadBuffer(fileKey, buffer, 'application/json', {
      abortSignal: signal,
      private: true,
    });
    if (signal.aborted) {
      // The upload landed after the task was failed; nothing references this file anymore.
      await fileService.deleteFile(fileKey).catch(() => {});
      signal.throwIfAborted();
    }

    return { fileKey, fileSize: buffer.byteLength };
  };

  private removeOlderExports = async (keepTaskId: string, fileService: FileService) => {
    const tasks = await this.taskModel.findAllByType(AsyncTaskType.DataExport);
    const keepIndex = tasks.findIndex((task) => task.id === keepTaskId);
    // Only exports created before the kept one; a newer export started meanwhile owns its own cleanup.
    const older = keepIndex === -1 ? [] : tasks.slice(keepIndex + 1);

    for (const task of older) {
      if (task.status === AsyncTaskStatus.Processing && !isStale(task)) continue;

      const fileKey = (task.metadata as DataExportTaskMetadata | null)?.fileKey;
      try {
        if (fileKey) await fileService.deleteFile(fileKey);
        await this.taskModel.delete(task.id);
      } catch (error) {
        // A leftover old file only costs storage; the new export is already usable.
        console.error('[data-export] failed to remove old export %s: %O', task.id, error);
      }
    }
  };

  private notify = async (taskId: string, status: 'error' | 'success') => {
    try {
      await notifyDataExportResult({
        status,
        taskId,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      // The settings page still shows the result; a lost notification must not fail the export.
      console.error('[data-export] notify %s failed: %O', taskId, error);
    }
  };
}
