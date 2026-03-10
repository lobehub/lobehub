import {
  type AsyncTaskStatus,
  type IAsyncTaskError,
  type UserMemoryExtractionMetadata,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface MemoryExtractionTask {
  error?: IAsyncTaskError | null;
  id: string;
  metadata: UserMemoryExtractionMetadata;
  status: AsyncTaskStatus;
}

export interface RequestMemoryExtractionParams {
  fromDate?: Date;
  toDate?: Date;
}

export interface RequestMemoryExtractionResult extends MemoryExtractionTask {
  deduped: boolean;
}

class MemoryExtractionService {
  requestFromChatTopics = async (
    params: RequestMemoryExtractionParams,
  ): Promise<RequestMemoryExtractionResult> => {
    return lambdaClient.userMemory.requestMemoryFromChatTopic.mutate(params);
  };

  getTask = async (taskId?: string): Promise<MemoryExtractionTask | null> => {
    return lambdaClient.userMemory.getMemoryExtractionTask.query(
      taskId ? { taskId } : undefined,
    ) as Promise<MemoryExtractionTask | null>;
  };
}

export const memoryExtractionService = new MemoryExtractionService();
