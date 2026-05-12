import type { UIChatMessage } from '@lobechat/types';

/**
 * Consumer-side metadata extensions for PipelineContext.metadata.
 *
 * Example:
 * declare module '@lobechat/context-engine' {
 *   interface PipelineContextMetadataOverrides {
 *     myCustomFlag?: boolean;
 *   }
 * }
 */
export interface PipelineContextMetadataOverrides {}

/**
 * Agent state - inferred from original project types
 */
export interface AgentState {
  [key: string]: any;
  messages: UIChatMessage[];
  model?: string;
  provider?: string;
  systemRole?: string;
  tools?: string[];
}

/**
 * Chat image item
 */
export interface ChatImageItem {
  alt?: string;
  id: string;
  url: string;
}

/**
 * Message tool call
 */
export interface MessageToolCall {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
  thoughtSignature?: string;
  type: 'function';
}
export interface Message {
  [key: string]: any;
  content: string | any[];
  role: string;
}

/**
 * Metadata shared across pipeline processors.
 * Consumers can extend this through declaration merging on
 * `LobeChatContextEngine.PipelineContextMetadataOverrides`.
 */
export interface PipelineContextMetadata extends PipelineContextMetadataOverrides {
  [key: `${string}InjectedCount`]: number | undefined;
  currentTokenCount?: number;
  maxTokens?: number;
  model?: string;
  provider?: string;
}

/**
 * Pipeline context - core data structure flowing through the pipeline
 */
export interface PipelineContext {
  /** Abort reason */
  abortReason?: string;

  /** Immutable input state */
  readonly initialState: AgentState;

  /** Allow processors to terminate pipeline early */
  isAborted: boolean;

  /** Mutable message list being built */
  messages: Message[];
  /** Metadata for communication between processors */
  metadata: PipelineContextMetadata;
}

/**
 * Context processor interface - standardized interface for processing stations in the pipeline
 */
export interface ContextProcessor {
  /** Processor name, used for debugging and logging */
  name: string;
  /** Core processing method */
  process: (context: PipelineContext) => Promise<PipelineContext>;
}

/**
 * Processor configuration options
 */
export interface ProcessorOptions {
  /** Whether to enable debug mode */
  debug?: boolean;
  /** Custom logging function */
  logger?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  /** Abort reason */
  abortReason?: string;
  /** Whether aborted */
  isAborted: boolean;
  /** Final processed messages */
  messages: any[];
  /** Metadata from processing */
  metadata: PipelineContextMetadata;
  /** Execution statistics */
  stats: {
    /** Number of processors processed */
    processedCount: number;
    /** Execution time for each processor */
    processorDurations: Record<string, number>;
    /** Total processing time */
    totalDuration: number;
  };
}

/**
 * Processor type enum
 */
export enum ProcessorType {
  /** Processor type */
  PROCESSOR = 'processor',
}

/** Legacy processor type - kept for backward compatibility */
export type ProcessorTypeLegacy =
  | 'injector'
  | 'transformer'
  | 'validator'
  | 'optimizer'
  | 'processor';

/**
 * Token counter interface
 */
export interface TokenCounter {
  count: (messages: UIChatMessage[] | string) => Promise<number>;
}

/**
 * File context information
 */
export interface FileContext {
  addUrl?: boolean;
  fileList?: string[];
  imageList?: ChatImageItem[];
}

/**
 * RAG retrieval chunk
 */
export interface RetrievalChunk {
  content: string;
  id: string;
  metadata?: Record<string, any>;
  similarity: number;
}

/**
 * RAG context
 */
export interface RAGContext {
  chunks: RetrievalChunk[];
  queryId?: string;
  rewriteQuery?: string;
}

/**
 * Model capabilities
 */
export interface ModelCapabilities {
  supportsFunctionCall: boolean;
  supportsReasoning: boolean;
  supportsSearch: boolean;
  supportsVision: boolean;
}

/**
 * Processor error — carries diagnostic context about which processor failed and why.
 *
 * The `cause` chain follows the ES2022 standard so that error-reporting tooling
 * (Sentry, DataDog, dashboard log viewers) can walk the full causal chain without
 * custom deserialisation.  The legacy `originalError` property is kept for
 * backwards compatibility with existing catch sites that destructure it directly.
 */
export class ProcessorError extends Error {
  /** @deprecated Prefer reading the standard `cause` property. */
  public originalError?: Error;

  constructor(
    public processorName: string,
    message: string,
    cause?: Error,
  ) {
    super(`[${processorName}] ${message}`, { cause });
    this.name = 'ProcessorError';
    this.originalError = cause;
  }

  /** Serialise the full causal chain so log aggregators can ingest it. */
  toJSON(): Record<string, unknown> {
    return {
      message: this.message,
      name: this.name,
      processorName: this.processorName,
      cause: this.cause
        ? this.cause instanceof Error && typeof (this.cause as any).toJSON === 'function'
          ? (this.cause as any).toJSON()
          : String(this.cause)
        : undefined,
    };
  }
}

/**
 * Pipeline error — thrown when a pipeline processor fails.
 *
 * Same design principles as {@link ProcessorError}: standard `cause` chain,
 * legacy `originalError` compatibility, and a `toJSON()` that preserves the
 * full error tree.
 */
export class PipelineError extends Error {
  /** @deprecated Prefer reading the standard `cause` property. */
  public originalError?: Error;

  constructor(
    message: string,
    public processorName?: string,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = 'PipelineError';
    this.originalError = cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      message: this.message,
      name: this.name,
      processorName: this.processorName,
      cause: this.cause
        ? this.cause instanceof Error && typeof (this.cause as any).toJSON === 'function'
          ? (this.cause as any).toJSON()
          : String(this.cause)
        : undefined,
    };
  }
}

export type { UIChatMessage } from '@lobechat/types';
