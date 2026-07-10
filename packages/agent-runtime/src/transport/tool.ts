import type { ChatToolPayload } from '@lobechat/types';

import type { AgentState } from '../types';
import type { RuntimeRetryKind } from '../utils';

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

export interface ToolRunExecution {
  attempts: number;
  mocked?: boolean;
  result: ToolRunResult;
}

/**
 * Per-call context the runtime knows at the moment of a tool call. The heavy
 * server context (tool manifest map, sub-agent / group-member runners, DB
 * handle, client-dispatch + result-archival + device-audit) is bound when the
 * adapter is constructed — NOT passed here — so this stays transport-neutral.
 */
export interface ToolRunContext {
  activatedSkills?: unknown[];
  activeDeviceId?: string;
  agentId?: string;
  assistantMessageId?: string;
  callIndex: number;
  effectiveManifestMap: Record<string, any>;
  groupId?: string;
  messageId?: string;
  mode: 'batch' | 'single';
  operationId: string;
  parentMessageId: string;
  parsedArgs: Record<string, unknown>;
  state: AgentState;
  stepIndex: number;
  threadId?: string;
  toolName: string;
  toolResultMaxLength?: number;
  toolSource?: string;
  topicId?: string;
  workspaceId?: string;
}

/**
 * Executes a single tool call. Server adapter wraps `ToolExecutionService`
 * (absorbing `dispatchClientTool`, result archival, and device audit); the
 * client adapter wraps `internal_invokeDifferentTypePlugin`.
 */
export interface ToolTransport {
  getCost?: (toolName: string) => number;
  handleError?: (
    call: ChatToolPayload,
    error: unknown,
    context: ToolRunContext,
  ) => Promise<void> | void;
  maxRetries?: number;
  run: (call: ChatToolPayload, context: ToolRunContext) => Promise<ToolRunExecution>;
  shouldRetry?: (kind: RuntimeRetryKind, attempt: number, maxRetries: number) => boolean;
}
