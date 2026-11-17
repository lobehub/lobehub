import type { DataExportView } from '@lobechat/types';
import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';
import { createAsyncCaller } from '@/server/routers/async';
import { after } from '@/server/utils/scheduleAfterResponse';

import { DataExportService, toDataExportView } from './index';

/**
 * Queue a data export and hand it to the async router, or return the export
 * already running. Kept apart from `DataExportService` so the async router can
 * import that service without importing itself back.
 *
 * The export runs in its own request because a large account can take
 * minutes; the caller only waits for the task row.
 */
export const startDataExport = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
): Promise<DataExportView> => {
  const service = new DataExportService(db, userId, workspaceId);

  // The check and the insert run under one lock per scope, so two tabs (or two
  // quick clicks) that start at once queue one export, not two.
  const queued = await db.transaction(async (tx): Promise<DataExportView | string> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`dataExport:${workspaceId ?? userId}`})::bigint)`,
    );
    const scoped = new DataExportService(tx as unknown as LobeChatDatabase, userId, workspaceId);
    const running = await scoped.findRunning();
    return running ? toDataExportView(running) : scoped.createTask();
  });
  // An export already running is returned as is; only a new task is handed off.
  if (typeof queued !== 'string') return queued;

  const taskId = queued;

  // Hand off after this response is sent, so the click returns at once.
  after(async () => {
    try {
      const asyncCaller = await createAsyncCaller({ userId });
      await asyncCaller.dataExport.run({ taskId, workspaceId });
    } catch (error) {
      // A run the async router already claimed owns its result (a proxy may
      // drop a long response); only a hand-off that never started is failed here.
      console.error('[data-export] hand-off of export %s failed: %O', taskId, error);
      await service.failUnclaimed(taskId, 'Failed to start the data export');
    }
  });

  const task = await service.getLatest();
  return task ?? { createdAt: new Date(), id: taskId, status: 'processing' };
};
