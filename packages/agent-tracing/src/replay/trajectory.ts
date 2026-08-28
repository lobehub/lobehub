import { resolvePayloads } from '../analysis/contextLint';
import type { ExecutionSnapshot } from '../types';
import { type FrozenCall, resolveStepTools } from './payload';

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

export interface RecordedToolResult {
  name: string;
  output: string;
}

/** Every `call_llm` step of a snapshot, in order, with the payload it saw. */
export const listFrozenCalls = (snapshot: ExecutionSnapshot): FrozenCall[] =>
  resolvePayloads(snapshot).payloads.map(({ messages, stepIndex }) => ({
    messages,
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
 * Results of the `call_tool` steps that ran between this `call_llm` node and
 * the next one — the only tool outputs a replay can hand back, since replaying
 * cannot re-execute a tool.
 */
export const recordedToolResults = (
  snapshot: ExecutionSnapshot,
  callStepIndex: number,
): RecordedToolResult[] => {
  const results: RecordedToolResult[] = [];

  for (const step of snapshot.steps) {
    if (step.stepIndex <= callStepIndex) continue;
    if (step.stepType === 'call_llm') break;

    for (const result of step.toolsResult ?? []) {
      results.push({
        name: `${result.identifier}${TOOL_NAME_SEPARATOR}${result.apiName}`,
        output: result.output ?? '',
      });
    }
  }

  return results;
};

/**
 * Comparable shape of a node's tool calls. Arguments are excluded: two models
 * can reach the same step of a trajectory with differently-phrased arguments,
 * and treating that as divergence would report noise as failure.
 */
export const toolSignature = (calls: Array<{ name: string }>): string =>
  calls.map((call) => call.name).join(' → ');

export interface ChainTurn {
  [key: string]: unknown;
  role: string;
}

/**
 * Build the tool messages that feed the next node, pairing each of the model's
 * tool calls with a recorded result for the same tool. Matching is by name in
 * call order — the recorded run is the only source of tool output, so a call
 * with no counterpart is reported rather than invented.
 */
export const buildToolMessages = (
  toolCalls: Array<{ id?: string; name: string }>,
  results: RecordedToolResult[],
): { messages: ChainTurn[]; unmatched: string[] } => {
  const pool = new Map<string, string[]>();
  for (const result of results) {
    const queue = pool.get(result.name) ?? [];
    queue.push(result.output);
    pool.set(result.name, queue);
  }

  const messages: ChainTurn[] = [];
  const unmatched: string[] = [];

  for (const [index, call] of toolCalls.entries()) {
    const queue = pool.get(call.name);
    const output = queue?.shift();

    if (output === undefined) {
      unmatched.push(call.name);
      continue;
    }

    messages.push({
      content: output,
      name: call.name,
      role: 'tool',
      tool_call_id: call.id ?? `replay_call_${index}`,
    });
  }

  return { messages, unmatched };
};

const messageIdentity = (message: unknown): string => {
  const m = message as { content?: unknown; role?: string; tool_calls?: unknown };
  return JSON.stringify([m?.role, m?.content ?? '', m?.tool_calls ?? null]);
};

export interface AnchorMatch {
  /** Index into the recorded payload where the model-produced tail begins. */
  index: number;
  /** Which replayed node that tail starts at. */
  nodeOffset: number;
}

/**
 * Find where a recorded payload starts carrying model-produced turns.
 *
 * The context engine re-renders the payload on every call — injected blocks
 * appear, move, and drop out — so a chained replay cannot append to the
 * previous payload. It splices instead: keep the harness's rendering of this
 * call verbatim, and replace only the turns the model produced. This locates
 * that boundary by finding the earliest recorded assistant turn still present.
 */
export const findChainAnchor = (
  recordedPayload: unknown[],
  recordedAssistants: unknown[],
): AnchorMatch | undefined => {
  const identities = recordedPayload.map((message) => messageIdentity(message));

  for (const [nodeOffset, assistant] of recordedAssistants.entries()) {
    const identity = messageIdentity(assistant);
    const index = identities.indexOf(identity);
    if (index >= 0) return { index, nodeOffset };
  }

  return undefined;
};

/**
 * The recorded assistant turn for a node, in provider message shape, so it can
 * be located inside a later payload and swapped for the replayed one.
 */
export const recordedAssistantTurn = (
  snapshot: ExecutionSnapshot,
  stepIndex: number,
): ChainTurn | undefined => {
  const step = snapshot.steps.find((s) => s.stepIndex === stepIndex);
  const delta = step?.messagesDelta?.find((message: any) => message?.role === 'assistant');
  return delta as ChainTurn | undefined;
};

/** Splice replayed turns into a recorded payload at the anchor. */
export const spliceChainedPayload = (
  recordedPayload: unknown[],
  anchor: AnchorMatch,
  replayedTurns: ChainTurn[],
): unknown[] => [...recordedPayload.slice(0, anchor.index), ...replayedTurns];
