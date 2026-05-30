import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';

import { MemoryExtractionExecutor } from './extract';

export interface TaskStatusDependencies {
  createAsyncTaskModel: (db: any, userId: string) => AsyncTaskModel;
}

export interface ExtractorDependencies {
  getServerDB: () => Promise<any>;
  createExecutor: () => Promise<MemoryExtractionExecutor>;
}

export const defaultTaskStatusDeps: TaskStatusDependencies = {
  createAsyncTaskModel: (db, userId) => new AsyncTaskModel(db, userId),
};

export const defaultExtractorDeps: ExtractorDependencies = {
  createExecutor: () => MemoryExtractionExecutor.create(),
  getServerDB,
};
