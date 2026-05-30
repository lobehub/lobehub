import { type TaskStatusDependencies, defaultTaskStatusDeps } from './dependencies';

export async function isTaskCancelled(
  db: any,
  userId: string,
  asyncTaskId: string,
  deps?: TaskStatusDependencies,
): Promise<boolean> {
  const asyncTaskModel = (deps?.createAsyncTaskModel ?? defaultTaskStatusDeps.createAsyncTaskModel)(db, userId);
  return asyncTaskModel.isUserMemoryExtractionCancellationRequested(asyncTaskId);
}

export async function updateTaskProgress(
  db: any,
  userId: string,
  asyncTaskId: string,
  deps?: TaskStatusDependencies,
): Promise<void> {
  const asyncTaskModel = (deps?.createAsyncTaskModel ?? defaultTaskStatusDeps.createAsyncTaskModel)(db, userId);
  await asyncTaskModel.incrementUserMemoryExtractionProgress(asyncTaskId);
}

export async function markTaskStatus(
  db: any,
  userId: string,
  asyncTaskId: string,
  status: 'success' | 'error',
  error?: any,
  deps?: TaskStatusDependencies,
): Promise<void> {
  const asyncTaskModel = (deps?.createAsyncTaskModel ?? defaultTaskStatusDeps.createAsyncTaskModel)(db, userId);
  if (status === 'error') {
    await asyncTaskModel.update(asyncTaskId, {
      status: 'error',
      error: { type: 'TaskFailed', message: error?.message || 'Unknown error' },
    });
  } else {
    await asyncTaskModel.update(asyncTaskId, { status: 'success' });
  }
}
