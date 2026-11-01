import { resolvePayloads } from '../analysis/contextLint';
import type { ExecutionSnapshot } from '../types';
import { type FrozenCall, resolveStepParams, resolveStepTools } from './payload';

/** Tool identifiers are exposed to the model as `identifier____apiName`. */
const TOOL_NAME_SEPARATOR = '____';

export interface RecordedToolCall {
  arguments?: string;
  name: string;
}

/** What the recorded run actually produced at one `call_llm` node. */
export interface RecordedOutcome {
  content: string;
  toolCalls: RecordedToolCall[];
}

/** Every `call_llm` step of a snapshot, in order, with the payload it saw. */
export const listFrozenCalls = (snapshot: ExecutionSnapshot): FrozenCall[] =>
  resolvePayloads(snapshot).payloads.map(({ messages, stepIndex }) => ({
    messages,
    params: resolveStepParams(snapshot, stepIndex),
    stepIndex,
    tools: resolveStepTools(snapshot, stepIndex),
  }));

export const recordedOutcome = (
  snapshot: ExecutionSnapshot,
  stepIndex: number,
): RecordedOutcome => {
  const step = snapshot.steps.find((s) => s.stepIndex === stepIndex);

  return {
    content: step?.content ?? '',
    toolCalls: (step?.toolsCalling ?? []).map((call) => ({
      arguments: call.arguments,
      name: `${call.identifier}${TOOL_NAME_SEPARATOR}${call.apiName}`,
    })),
  };
};

/**
 * Comparable shape of a node's tool calls. Arguments are excluded: two models
 * can reach the same step of a trajectory with differently-phrased arguments,
 * and treating that as divergence would report noise as failure.
 */
export const toolSignature = (calls: Array<{ name: string }>): string =>
  calls.map((call) => call.name).join(' → ');
