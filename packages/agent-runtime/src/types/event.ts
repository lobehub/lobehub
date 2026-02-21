/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import type { ChatToolPayload } from '@lobechat/types';

import type { AgentState, ToolsCalling } from './state';

export interface AgentEventInit {
  type: 'init';
}

export interface AgentEventLlmStart {
  payload: unknown;
  type: 'llm_start';
}

export interface AgentEventLlmStream {
  chunk: unknown;
  type: 'llm_stream';
}

export interface AgentEventLlmResult {
  result: unknown;
  type: 'llm_result';
}

export interface AgentEventToolPending {
  toolCalls: ToolsCalling[];
  type: 'tool_pending';
}

export interface AgentEventToolResult {
  id: string;
  result: any;
  type: 'tool_result';
}

export interface AgentEventHumanApproveRequired {
  operationId: string;
  pendingToolsCalling: ChatToolPayload[];
  type: 'human_approve_required';
}

export interface AgentEventHumanPromptRequired {
  metadata?: Record<string, unknown>;
  operationId: string;
  prompt: string;
  type: 'human_prompt_required';
}

export interface AgentEventHumanSelectRequired {
  metadata?: Record<string, unknown>;
  multi?: boolean;
  operationId: string;
  options: { label: string; value: string }[];
  prompt?: string;
  type: 'human_select_required';
}

/**
 * Standardized finish reasons
 */
export type FinishReason =
  | 'completed' // Normal completion
  | 'user_requested' // User requested to end
  | 'user_aborted' // User abort
  | 'max_steps_exceeded' // Reached maximum steps limit
  | 'cost_limit_exceeded' // Reached cost limit
  | 'timeout' // Execution timeout
  | 'agent_decision' // Agent decided to finish
  | 'error_recovery' // Finished due to unrecoverable error
  | 'system_shutdown'; // System is shutting down

export interface AgentEventDone {
  finalState: AgentState;
  reason: FinishReason;
  reasonDetail?: string;
  type: 'done';
}

export interface AgentEventError {
  error: any;
  type: 'error';
}

export interface AgentEventInterrupted {
  canResume: boolean;
  interruptedAt: string;
  interruptedInstruction?: any;
  metadata?: Record<string, unknown>;
  reason: string;
  type: 'interrupted';
}

export interface AgentEventResumed {
  metadata?: Record<string, unknown>;
  reason: string;
  resumedAt: string;
  resumedFromStep: number;
  type: 'resumed';
}

export interface AgentEventCompressionComplete {
  groupId: string;
  parentMessageId?: string;
  type: 'compression_complete';
}

export interface AgentEventCompressionError {
  error: unknown;
  type: 'compression_error';
}

/**
 * Events emitted by the AgentRuntime during execution
 */
export type AgentEvent =
  // Initialization
  | AgentEventInit
  // LLM streaming output
  | AgentEventLlmStart
  | AgentEventLlmStream
  | AgentEventLlmResult
  // Tool invocation
  | AgentEventToolPending
  | AgentEventToolResult
  // Normal completion
  | AgentEventDone
  // Error thrown
  | AgentEventError
  // Human-in-the-loop (HIL)
  | AgentEventHumanApproveRequired
  | AgentEventHumanPromptRequired
  | AgentEventHumanSelectRequired
  // Interruption and resumption
  | AgentEventInterrupted
  | AgentEventResumed
  // Context compression
  | AgentEventCompressionComplete
  | AgentEventCompressionError;
