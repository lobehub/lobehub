import { type LobeToolManifest } from '@lobechat/context-engine';
import { type ChatToolPayload } from '@lobechat/types';

export interface ToolExecutionContext {
  toolManifestMap: Record<string, LobeToolManifest>;
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
  execute(payload: ChatToolPayload, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
