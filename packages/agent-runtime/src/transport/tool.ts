import type { ChatToolPayload } from '@lobechat/types';

/** Neutral mirror of the server `ToolExecutionResultResponse`. */
export interface ToolRunResult {
  content: string;
  /** Server tool paused (client/device dispatch) — result arrives later. */
  deferred?: boolean;
  error?: unknown;
  executionTime?: number;
  state?: Record<string, any>;
  success: boolean;
}

/**
 * Per-call context the runtime knows at the moment of a tool call. The heavy
 * server context (tool manifest map, sub-agent / group-member runners, DB
 * handle, client-dispatch + result-archival + device-audit) is bound when the
 * adapter is constructed — NOT passed here — so this stays transport-neutral.
 */
export interface ToolRunContext {
  activeDeviceId?: string;
  agentId?: string;
  assistantMessageId?: string;
  groupId?: string;
  messageId?: string;
  threadId?: string;
  topicId?: string;
}

/**
 * Executes a single tool call. Server adapter wraps `ToolExecutionService`
 * (absorbing `dispatchClientTool`, result archival, and device audit); the
 * client adapter wraps `internal_invokeDifferentTypePlugin`.
 */
export interface ToolTransport {
  run: (call: ChatToolPayload, context: ToolRunContext) => Promise<ToolRunResult>;
}
