import type { AgentState } from '@lobechat/agent-runtime';

import { type StepCompletionReason } from '../types';

/**
 * Decide whether to continue execution
 */
export function shouldContinueExecution(state: any, context?: any): boolean {
  // Completed
  if (state.status === 'done') return false;

  // Needs human intervention
  if (state.status === 'waiting_for_human') return false;

  // Parked waiting for an async tool result (client tool / sub-agent)
  if (state.status === 'waiting_for_async_tool') return false;

  // Parked waiting for a client to run the next LLM call
  if (state.status === 'waiting_for_client') return false;

  // Error occurred
  if (state.status === 'error') return false;

  // Interrupted
  if (state.status === 'interrupted') return false;

  // maxSteps is handled by runtime.step() which sets forceFinish → status:'done'
  // No redundant check here — trust the runtime state machine

  // Exceeded cost limit
  if (state.costLimit && state.cost?.total >= state.costLimit.maxTotalCost) {
    return state.costLimit.onExceeded !== 'stop';
  }

  // No next context
  if (!context) return false;

  return true;
}

/**
 * Calculate step delay
 */
export function calculateStepDelay(stepResult: any): number {
  const baseDelay = 50;

  // If there are tool calls, add longer delay
  if (stepResult.events?.some((e: any) => e.type === 'tool_result')) {
    return baseDelay + 50;
  }

  // If there are errors, use exponential backoff
  if (stepResult.events?.some((e: any) => e.type === 'error')) {
    return Math.min(baseDelay * 2, 1000);
  }

  return baseDelay;
}

/**
 * Calculate priority
 */
export function calculatePriority(stepResult: any): 'high' | 'normal' | 'low' {
  // If human intervention needed, high priority
  if (stepResult.newState?.status === 'waiting_for_human') {
    return 'high';
  }

  // If there are errors, normal priority
  if (stepResult.events?.some((e: any) => e.type === 'error')) {
    return 'normal';
  }

  return 'normal';
}

/**
 * Determine operation completion reason
 */
export function determineCompletionReason(state: AgentState): StepCompletionReason {
  if (state.status === 'error') return 'error';
  if (state.status === 'interrupted') return 'interrupted';
  if (state.status === 'waiting_for_human') return 'waiting_for_human';
  if (state.status === 'waiting_for_async_tool') return 'waiting_for_async_tool';
  if (state.status === 'waiting_for_client') return 'waiting_for_client';
  // Checked ahead of 'done' on purpose: a run the repeat guard cut short ends
  // in exactly that status, having emitted a turn with no tool calls. Reading
  // it as a plain 'done' is what made these runs uncountable.
  if (state.toolCallRepeatGuard?.stoppedByRepeatLimit) return 'tool_call_repeat_limit';
  if (state.status === 'done') return 'done';
  if (state.maxSteps && state.stepCount >= state.maxSteps) return 'max_steps';
  if (state.costLimit && state.cost?.total >= state.costLimit.maxTotalCost) return 'cost_limit';
  return 'done';
}
