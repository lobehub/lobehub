export enum AsyncTaskType {
  Chunking = 'chunk',
  Embedding = 'embedding',
  ImageGeneration = 'image_generation',
  UserMemoryExtractionHourly = 'user_memory_extraction:hourly',
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
  /**
   * Model not found on server
   */
  ModelNotFound = 'ModelNotFound',
  /* ↑ cloud slot ↑ */

  /**
   * the chunk parse result it empty
   */
  NoChunkError = 'NoChunkError',
  ProviderContentModeration = 'ProviderContentModeration',
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
  /* ↓ cloud slot | workspace freeze ↓ */
  /**
   * Workspace was manually frozen by an admin; spend is blocked until unfrozen.
   */
  WorkspaceFrozenByAdmin = 'WorkspaceFrozenByAdmin',
  /**
   * Workspace was auto-frozen by risk control after abnormal spend; spend is blocked
   * until manually unfrozen by an admin.
   */
  WorkspaceFrozenByRiskControl = 'WorkspaceFrozenByRiskControl',
  /* ↑ cloud slot ↑ */
}

export interface AsyncTaskStructuredErrorItem {
  /**
   * Structured error cause when the top-level error wraps a lower-level failure.
   */
  cause?: AsyncTaskStructuredErrorItem;
  /**
   * Machine-readable error code from lower-level libraries or database drivers.
   */
  code?: string;
  layer?: string;
  memoryIndex?: number;
  message: string;
  /**
   * Error class name, for example `DrizzleQueryError` or `PostgresError`.
   */
  name?: string;
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

/**
 * Provider metadata for Upstash workflow-backed async task runs.
 */
export interface UpstashWorkflowRunMetadata {
  /**
   * Workflow run id of the wrapper run that created this async task.
   */
  entryWorkflowRunId?: string;
  /**
   * Known workflow run ids associated with this task.
   */
  workflowRunIds?: string[];
}

/**
 * Shared cancellation metadata for memory extraction async tasks.
 */
export interface MemoryExtractionControlMetadata {
  /**
   * Who initiated cancellation.
   */
  cancelledBy?: 'system' | 'user' | 'webhook';
  /**
   * Human-readable reason for cancellation when available.
   */
  cancelReason?: string;
  /**
   * ISO timestamp indicating when cancellation was requested.
   */
  cancelRequestedAt?: string;
  /**
   * Provider-specific cancellation metadata.
   */
  upstash?: UpstashWorkflowRunMetadata;
}

export interface UserMemoryExtractionMetadata {
  control?: MemoryExtractionControlMetadata;
  progress: UserMemoryExtractionProgress;
  range?: {
    from?: string;
    to?: string;
  };
  source: 'chat_topic';
}

/**
 * Progress counters for hourly user memory extraction scheduler runs.
 */
export interface HourlyUserMemoryExtractionProgress {
  processedUsers: number;
  scheduledBatches: number;
  scheduledChildRuns: number;
}

/**
 * Metadata persisted for hourly user memory extraction async tasks.
 */
export interface HourlyUserMemoryExtractionMetadata {
  control?: MemoryExtractionControlMetadata;
  cursor?: {
    createdAt: string;
    id: string;
  };
  progress: HourlyUserMemoryExtractionProgress;
  source: 'hourly_chat_topic';
  startedAt: string;
}

export interface VideoGenerationTaskMetadata {
  precharge?: Record<string, unknown>;
  webhookToken?: string;
}
