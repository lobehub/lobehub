import type { ChatToolPayload, RuntimeStepContext } from '@lobechat/types';

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
  /** Tool result requests the current runtime flow to stop. */
  stop?: boolean;
  success: boolean;
}

export interface ToolRunExecution {
  attempts: number;
  /** Execution was cancelled after the client created its optimistic message. */
  interrupted?: boolean;
  mocked?: boolean;
  result: ToolRunResult;
  /** The transport already persisted the result into its tool message. */
  resultPersisted?: boolean;
  /** Existing/pre-created tool message owned by the transport. */
  toolMessageId?: string;
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
  /** Reuse the parent tool message when resuming after intervention. */
  reuseExistingMessage?: boolean;
  state: AgentState;
  stepContext?: RuntimeStepContext;
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
  /** This runtime can execute tools whose source is the client directly. */
  canRunClientTools?: boolean;
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
