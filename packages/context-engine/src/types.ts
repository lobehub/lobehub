import { ChatMessage } from '@lobechat/types';

/**
 * 智能体状态 - 从原项目类型推断
 */
export interface AgentState {
  [key: string]: any;
  messages: ChatMessage[];
  model?: string;
  provider?: string;
  systemRole?: string;
  tools?: string[];
}

/**
 * 聊天图像项
 */
export interface ChatImageItem {
  alt?: string;
  id: string;
  url: string;
}

/**
 * 消息工具调用
 */
export interface MessageToolCall {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
  type: 'function';
}
export interface Message {
  [key: string]: any;
  content: string | any[];
  role: string;
}

/**
 * 管道上下文 - 在管道中流动的核心数据结构
 */
export interface PipelineContext {
  /** 中止原因 */
  abortReason?: string;

  /** 不可变的输入状态 */
  readonly initialState: AgentState;

  /** 允许处理器提前终止管道 */
  isAborted: boolean;

  /** 正在构建的可变消息列表 */
  messages: Message[];
  /** 处理器间通信的元数据 */
  metadata: {
    /** 其他自定义元数据 */
    [key: string]: any;
    /** 当前 token 估算值 */
    currentTokenCount?: number;
    /** 最大 token 限制 */
    maxTokens?: number;
    /** 模型标识 */
    model?: string;
  };
}

/**
 * 上下文处理器接口 - 管道中处理站的标准化接口
 */
export interface ContextProcessor {
  /** 处理器名称，用于调试和日志 */
  name: string;
  /** 核心处理方法 */
  process: (context: PipelineContext) => Promise<PipelineContext>;
}

/**
 * 处理器配置选项
 */
export interface ProcessorOptions {
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 自定义日志函数 */
  logger?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/**
 * 管道执行结果
 */
export interface PipelineResult {
  /** 中止原因 */
  abortReason?: string;
  /** 是否被中止 */
  isAborted: boolean;
  /** 最终处理的消息 */
  messages: any[];
  /** 处理过程中的元数据 */
  metadata: Record<string, any>;
  /** 执行统计 */
  stats: {
    /** 处理的处理器数量 */
    processedCount: number;
    /** 各处理器执行时间 */
    processorDurations: Record<string, number>;
    /** 总处理时间 */
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
 * Token 计数器接口
 */
export interface TokenCounter {
  count: (messages: ChatMessage[] | string) => Promise<number>;
}

/**
 * 文件上下文信息
 */
export interface FileContext {
  addUrl?: boolean;
  fileList?: string[];
  imageList?: ChatImageItem[];
}

/**
 * RAG 检索块
 */
export interface RetrievalChunk {
  content: string;
  id: string;
  metadata?: Record<string, any>;
  similarity: number;
}

/**
 * RAG 上下文
 */
export interface RAGContext {
  chunks: RetrievalChunk[];
  queryId?: string;
  rewriteQuery?: string;
}

/**
 * 模型能力
 */
export interface ModelCapabilities {
  supportsFunctionCall: boolean;
  supportsReasoning: boolean;
  supportsSearch: boolean;
  supportsVision: boolean;
}

/**
 * 处理器错误
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
 * 管道错误
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

export type { ChatMessage } from '@lobechat/types';
