/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { ChatToolPayload } from '@lobechat/types';

import type { AgentState, ToolsCalling } from './state';

export interface AgentEventInit {
  type: 'init';
}

export interface AgentEventLlmStart {
  type: 'llm_start';
  payload: unknown;
}

export interface AgentEventLlmStream {
  type: 'llm_stream';
  chunk: unknown;
}

export interface AgentEventLlmResult {
  type: 'llm_result';
  result: unknown;
}

export interface AgentEventToolPending {
  type: 'tool_pending';
  toolCalls: ToolsCalling[];
}

export interface AgentEventToolResult {
  type: 'tool_result';
  id: string;
  result: any;
}

export interface AgentEventHumanApproveRequired {
  type: 'human_approve_required';
  pendingToolsCalling: ChatToolPayload[];
  operationId: string;
}

export interface AgentEventHumanPromptRequired {
  type: 'human_prompt_required';
  metadata?: Record<string, unknown>;
  prompt: string;
  operationId: string;
}

export interface AgentEventHumanSelectRequired {
  type: 'human_select_required';
  metadata?: Record<string, unknown>;
  multi?: boolean;
  options: { label: string; value: string }[];
  prompt?: string;
  operationId: string;
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
  type: 'done';
  finalState: AgentState;
  reason: FinishReason;
  reasonDetail?: string;
}

export interface AgentEventError {
  type: 'error';
  error: any;
}

export interface AgentEventInterrupted {
  type: 'interrupted';
  reason: string;
  interruptedAt: string;
  interruptedInstruction?: any;
  canResume: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentEventResumed {
  type: 'resumed';
  reason: string;
  resumedAt: string;
  resumedFromStep: number;
  metadata?: Record<string, unknown>;
}

export interface AgentEventCompressionComplete {
  type: 'compression_complete';
  groupId: string;
}

export interface AgentEventCompressionError {
  type: 'compression_error';
  error: unknown;
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
