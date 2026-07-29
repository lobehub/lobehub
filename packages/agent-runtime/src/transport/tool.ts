import type { ChatToolPayload, RuntimeStepContext, WorkRegistrationIntent } from '@lobechat/types';

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
  /**
   * Work-registration intent produced by the tool execution (task / skill /
   * document identity). The executor forwards it to
   * {@link ToolTransport.registerWork} once cumulative cost is known.
   */
  workRegistration?: WorkRegistrationIntent;
}

/**
 * A Work version ready to persist: the executor pairs the tool's registration
 * intent with provenance and the cumulative usage/cost snapshot as of that
 * tool call, so the version is inserted ONCE — no cost-less insert + backfill.
 */
export interface ToolWorkRegistration {
  intent: WorkRegistrationIntent;
  /** Tool message the Work version is anchored to. */
  sourceMessageId?: string;
  sourceToolCallId: string;
  /**
   * Tool/plugin identifier that produced this registration (the tool payload's
   * `identifier`, e.g. 'lobe-task' / 'lobe-agent-documents'). Stamped onto the
   * Work as the creator tool. Skills stamp their own provider DB-side instead.
   */
  sourceToolIdentifier: string;
  /** Fallback `source` for task Works (the API name); skills use their own toolName. */
  sourceToolName: string;
  /** Cumulative usage/cost as of this tool call. */
  state: Pick<AgentState, 'cost' | 'usage'>;
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
  /**
   * Pre-existing tool message the result will be written into (resume /
   * `skipCreateToolMessage` flow) — unset when a new tool message is created
   * after execution.
   */
  toolMessageId?: string;
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
  /**
   * Persists a Work version for a tool run that produced a
   * {@link ToolRunResult.workRegistration} intent. Called by the executor
   * AFTER usage accumulation so the registration carries the cumulative cost.
   */
  registerWork?: (registration: ToolWorkRegistration, state: AgentState) => Promise<void>;
  run: (call: ChatToolPayload, context: ToolRunContext) => Promise<ToolRunExecution>;
  shouldRetry?: (kind: RuntimeRetryKind, attempt: number, maxRetries: number) => boolean;
}
