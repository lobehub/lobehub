import type { MockEvent } from '../types';

export const initEvent = (): MockEvent => ({
  type: 'agent_runtime_init',
  data: {},
  delay: 0,
});

export const endEvent = (reason: string = 'done'): MockEvent => ({
  type: 'agent_runtime_end',
  data: { reason },
  delay: 0,
});

export const stepStart = (stepIndex: number, stepType: 'call_llm' | 'call_tool'): MockEvent => ({
  type: 'step_start',
  data: { stepIndex, stepType },
  delay: 0,
});

export const stepComplete = (stepIndex: number, phase: string): MockEvent => ({
  type: 'step_complete',
  data: { stepIndex, phase, reason: 'completed' },
  delay: 0,
});
