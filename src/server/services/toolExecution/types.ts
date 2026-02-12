import { type LobeToolManifest } from '@lobechat/context-engine';
import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatToolPayload } from '@lobechat/types';

export interface ToolExecutionContext {
  /** Server database for LobeHub Skills execution */
  serverDB?: LobeChatDatabase;
  toolManifestMap: Record<string, LobeToolManifest>;
  /**
   * Maximum length for tool execution result content (in characters)
   * @default 6000
   */
  toolResultMaxLength?: number;
  /** Topic ID for sandbox session management */
  topicId?: string;
  userId?: string;
}

export interface ToolExecutionResult {
  content: string;
  error?: any;
  state?: Record<string, any>;
  success: boolean;
}

export interface ToolExecutionResultResponse extends ToolExecutionResult {
  executionTime: number;
}

export interface IToolExecutor {
  execute: (
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>;
}
