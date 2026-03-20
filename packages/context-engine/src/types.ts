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
 * Processor error
 */
export class ProcessorError extends Error {
  constructor(
    public processorName: string,
    message: string,
    public originalError?: Error,
  ) {
    super(`[${processorName}] ${message}`);
    this.name = 'ProcessorError';
  }
}

/**
 * Pipeline error
 */
export class PipelineError extends Error {
  constructor(
    message: string,
    public processorName?: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export type { UIChatMessage } from '@lobechat/types';
