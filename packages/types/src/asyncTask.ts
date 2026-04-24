export enum AsyncTaskType {
  Chunking = 'chunk',
  Embedding = 'embedding',
  ImageGeneration = 'image_generation',
  UserMemoryExtractionWithChatTopic = 'user_memory_extraction:chat_topic',
  VideoGeneration = 'video_generation',
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
   * this happens when a task is intentionally cancelled
   */
  TaskCancelled = 'TaskCancelled',
  /**
   * this happens when the task is not trigger successfully
   */
  TaskTriggerError = 'TaskTriggerError',
  Timeout = 'TaskTimeout',
}

export interface AsyncTaskStructuredErrorItem {
  layer?: string;
  memoryIndex?: number;
  message: string;
  preview?: string;
  sourceId?: string;
  sourceType?: string;
  stack?: string;
  stage?: string;
}

export interface AsyncTaskErrorBody {
  detail: string;
  extractErrors?: AsyncTaskStructuredErrorItem[];
  persistErrors?: AsyncTaskStructuredErrorItem[];
  progressErrors?: AsyncTaskStructuredErrorItem[];
  retrievalErrors?: AsyncTaskStructuredErrorItem[];
}

export interface IAsyncTaskError {
  body: string | AsyncTaskErrorBody;
  name: string;
}

export class AsyncTaskError implements IAsyncTaskError {
  constructor(name: string, message: string) {
    this.name = name;
    this.body = { detail: message };
  }

  name: string;

  body: AsyncTaskErrorBody;
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
  control?: {
    /**
     * Human-readable reason for cancellation when available.
     */
    cancelReason?: string;
    /**
     * ISO timestamp indicating when cancellation was requested.
     */
    cancelRequestedAt?: string;
    /**
     * Who initiated cancellation.
     */
    cancelledBy?: 'system' | 'user' | 'webhook';
    /**
     * Provider-specific cancellation metadata.
     */
    upstash?: {
      /**
       * Known workflow run ids associated with this task.
       */
      workflowRunIds?: string[];
    };
  };
  progress: UserMemoryExtractionProgress;
  range?: {
    from?: string;
    to?: string;
  };
  source: 'chat_topic';
}

export interface VideoGenerationTaskMetadata {
  precharge?: Record<string, unknown>;
  webhookToken?: string;
}
