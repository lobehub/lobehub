export enum AsyncTaskType {
  Chunking = 'chunk',
  Embedding = 'embedding',
  ImageGeneration = 'image_generation',
  UserMemoryExtractionWithChatTopic = 'user_memory_extraction:chat_topic',
}

export enum AsyncTaskStatus {
  Error = 'error',
  Pending = 'pending',
  Processing = 'processing',
  Success = 'success',
}

export enum AsyncTaskErrorType {
  EmbeddingError = 'EmbeddingError',

  /* ↓ cloud slot | free plan limit error type ↓ */
  /**
   * Free plan users are not allowed to use this feature
   */
  FreePlanLimit = 'FreePlanLimit',
  // eslint-disable-next-line typescript-sort-keys/string-enum
  InvalidProviderAPIKey = 'InvalidProviderAPIKey',
  /* ↑ cloud slot ↑ */

  /**
   * Model not found on server
   */
  ModelNotFound = 'ModelNotFound',
  /**
   * the chunk parse result it empty
   */
  NoChunkError = 'NoChunkError',
  ServerError = 'ServerError',
  /**
   * Subscription plan limit reached (paid users run out of credits)
   */
  SubscriptionPlanLimit = 'SubscriptionPlanLimit',
  /**
   * this happens when the task is not trigger successfully
   */
  TaskTriggerError = 'TaskTriggerError',
  Timeout = 'TaskTimeout',
}

export interface IAsyncTaskError {
  body: string | { detail: string };
  name: string;
}

export class AsyncTaskError implements IAsyncTaskError {
  constructor(name: string, message: string) {
    this.name = name;
    this.body = { detail: message };
  }

  name: string;

  body: { detail: string };
}

export interface FileParsingTask {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  finishEmbedding?: boolean;
}

export interface UserMemoryExtractionProgress {
  completedTopics: number;
  totalTopics: number | null;
}

export interface UserMemoryExtractionMetadata {
  progress: UserMemoryExtractionProgress;
  range?: {
    from?: string;
    to?: string;
  };
  source: 'chat_topic';
}
