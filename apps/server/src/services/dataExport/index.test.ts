// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { asyncTasks, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DATA_EXPORT_RUN_DEADLINE_MS,
  DATA_EXPORT_STALE_AFTER_MS,
  DataExportService,
} from './index';
import { startDataExport } from './start';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  createDownloadUrl: vi.fn(),
  deleteFile: vi.fn(),
  exportTables: vi.fn(),
  notify: vi.fn(),
  uploadBuffer: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      createDownloadUrl: mocks.createDownloadUrl,
      deleteFile: mocks.deleteFile,
      uploadBuffer: mocks.uploadBuffer,
    };
  }),
}));

vi.mock('@/database/repositories/dataExporter', () => ({
  DataExporterRepos: vi.fn().mockImplementation(function () {
    return { export: mocks.exportTables };
  }),
}));

vi.mock('@/database/models/drizzleMigration', () => ({
  DrizzleMigrationModel: vi.fn().mockImplementation(function () {
    return { getLatestMigrationHash: vi.fn().mockResolvedValue('schema-hash') };
  }),
}));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: mocks.after }));

vi.mock('@/server/routers/async', () => ({ createAsyncCaller: vi.fn() }));

vi.mock('@/business/server/data-export/notifyDataExportResult', () => ({
  notifyDataExportResult: mocks.notify,
}));

const db: LobeChatDatabase = await getTestDB();
const userId = 'data-export-service-user';

const getTask = async (id: string) =>
  (await db.select().from(asyncTasks).where(eq(asyncTasks.id, id)))[0];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  mocks.exportTables.mockResolvedValue({ topics: [{ id: 't1' }] });
  mocks.uploadBuffer.mockResolvedValue({ key: 'stored' });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('DataExportService', () => {
  it('stores the export file, marks it ready and notifies the user', async () => {
    const service = new DataExportService(db, userId);
    const taskId = await service.createTask();

    await service.run(taskId);

    const [key, buffer, contentType, options] = mocks.uploadBuffer.mock.calls[0];
    expect(key).toBe(`exports/${userId}/${taskId}.json`);
    expect(contentType).toBe('application/json');
    expect(options).toMatchObject({ private: true });
    expect(JSON.parse(buffer.toString())).toEqual({
      data: { topics: [{ id: 't1' }] },
      mode: 'postgres',
      schemaHash: 'schema-hash',
    });

    expect(await service.getLatest()).toMatchObject({
      fileSize: buffer.byteLength,
      id: taskId,
      status: 'success',
    });
    expect(mocks.notify).toHaveBeenCalledWith({ status: 'success', taskId, userId });
  });

  it('runs a task only once even when handed off twice', async () => {
    const service = new DataExportService(db, userId);
    const taskId = await service.createTask();

    await Promise.all([service.run(taskId), service.run(taskId)]);

    expect(mocks.exportTables).toHaveBeenCalledTimes(1);
  });

  it('marks the export failed and notifies the user when building it fails', async () => {
    mocks.exportTables.mockRejectedValue(new Error('db timeout'));
    const service = new DataExportService(db, userId);
    const taskId = await service.createTask();

    await service.run(taskId);

    expect((await getTask(taskId)).status).toBe(AsyncTaskStatus.Error);
    expect(await service.getLatest()).toMatchObject({ id: taskId, status: 'error' });
    expect(mocks.notify).toHaveBeenCalledWith({ status: 'error', taskId, userId });
  });

  it('keeps only the newest export file', async () => {
    const service = new DataExportService(db, userId);
    const firstId = await service.createTask();
    await service.run(firstId);
    await db
      .update(asyncTasks)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(asyncTasks.id, firstId));

    const secondId = await service.createTask();
    await service.run(secondId);

    expect(mocks.deleteFile).toHaveBeenCalledWith(`exports/${userId}/${firstId}.json`);
    expect(await getTask(firstId)).toBeUndefined();
    expect((await service.getLatest())?.id).toBe(secondId);
  });

  it('shows an export that never finished as failed and lets a new one start', async () => {
    const service = new DataExportService(db, userId);
    const [lost] = await db
      .insert(asyncTasks)
      .values({
        createdAt: new Date(Date.now() - DATA_EXPORT_STALE_AFTER_MS - 1000),
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.DataExport,
        userId,
      })
      .returning();

    expect(await service.getLatest()).toMatchObject({ id: lost.id, status: 'error' });
    expect(await service.findRunning()).toBeUndefined();
  });

  it('fails a hand-off that never started, but leaves a claimed run alone', async () => {
    const service = new DataExportService(db, userId);
    const unclaimedId = await service.createTask();
    const claimedId = await service.createTask();
    await db
      .update(asyncTasks)
      .set({ status: AsyncTaskStatus.Processing })
      .where(eq(asyncTasks.id, claimedId));

    await service.failUnclaimed(unclaimedId, 'hand-off failed');
    await service.failUnclaimed(claimedId, 'hand-off failed');

    expect((await getTask(unclaimedId)).status).toBe(AsyncTaskStatus.Error);
    expect((await getTask(claimedId)).status).toBe(AsyncTaskStatus.Processing);
  });

  it('only signs download links for a finished export', async () => {
    mocks.createDownloadUrl.mockResolvedValue('https://s3/signed');
    const service = new DataExportService(db, userId);
    const pendingId = await service.createTask();

    await expect(service.getDownloadUrl(pendingId)).rejects.toThrow('Data export not found');

    await service.run(pendingId);
    const result = await service.getDownloadUrl(pendingId);

    expect(result.url).toBe('https://s3/signed');
    expect(result.fileName).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}_LobeHub-data\.json$/);
    expect(mocks.createDownloadUrl).toHaveBeenCalledWith(
      `exports/${userId}/${pendingId}.json`,
      result.fileName,
      600,
    );
  });

  it('does not expose another user’s export', async () => {
    const service = new DataExportService(db, userId);
    const taskId = await service.createTask();
    await service.run(taskId);

    await db.insert(users).values({ id: 'data-export-other-user' }).onConflictDoNothing();
    const other = new DataExportService(db, 'data-export-other-user');

    expect(await other.getLatest()).toBeNull();
    await expect(other.getDownloadUrl(taskId)).rejects.toThrow('Data export not found');
    await db.delete(users).where(eq(users.id, 'data-export-other-user'));
  });

  it('does not store an export that finishes after its deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let finishExport!: (data: object) => void;
      mocks.exportTables.mockReturnValue(
        new Promise((resolve) => {
          finishExport = resolve;
        }),
      );
      const service = new DataExportService(db, userId);
      const taskId = await service.createTask();

      const run = service.run(taskId);
      await vi.advanceTimersByTimeAsync(DATA_EXPORT_RUN_DEADLINE_MS + 1);
      await run;
      finishExport({ topics: [] });
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.uploadBuffer).not.toHaveBeenCalled();
      expect((await getTask(taskId)).status).toBe(AsyncTaskStatus.Error);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a run that would outlive the host time limit as failed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      mocks.exportTables.mockReturnValue(new Promise(() => {}));
      const service = new DataExportService(db, userId);
      const taskId = await service.createTask();

      const run = service.run(taskId);
      await vi.advanceTimersByTimeAsync(DATA_EXPORT_RUN_DEADLINE_MS + 1);
      await run;

      expect((await getTask(taskId)).status).toBe(AsyncTaskStatus.Error);
      expect(mocks.notify).toHaveBeenCalledWith({ status: 'error', taskId, userId });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startDataExport', () => {
  it('queues one export when two starts arrive at once', async () => {
    const [first, second] = await Promise.all([
      startDataExport(db, userId, undefined),
      startDataExport(db, userId, undefined),
    ]);

    expect(first.id).toBe(second.id);
    expect(first.status).toBe('processing');
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(await db.select().from(asyncTasks).where(eq(asyncTasks.userId, userId))).toHaveLength(1);
  });
});
