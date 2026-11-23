import type { FileTaskRef } from './types';

type TriggerableFileTask = FileTaskRef & { admissionScope?: string };

/**
 * Builds the call to the async route, which runs over HTTP so the task keeps that route's memory
 * and duration limits. Calling the returned function sends the request synchronously: a caller
 * that does not wait for the result must still have sent it before its own response returns,
 * because a serverless function can be frozen right after.
 */
export const prepareFileTaskTrigger = async (task: TriggerableFileTask) => {
  // Kept dynamic on purpose: the async router imports the chunk service, which imports this
  // module, so a static import would form a real cycle that `lint:circular` rejects.
  const { createAsyncCaller } = await import('@/server/routers/async');
  const asyncCaller = await createAsyncCaller({ userId: task.userId });
  const input = {
    fileId: task.fileId,
    taskId: task.taskId,
    ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
    ...(task.admissionScope ? { admissionScope: task.admissionScope } : {}),
  };

  return async () =>
    task.kind === 'parse'
      ? asyncCaller.file.parseFileToChunks(input)
      : asyncCaller.file.embeddingChunks(input);
};

export const triggerFileTask = async (task: TriggerableFileTask) => {
  const send = await prepareFileTaskTrigger(task);
  return send();
};
