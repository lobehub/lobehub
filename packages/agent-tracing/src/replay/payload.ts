import { resolvePayloads } from '../analysis/contextLint';
import type { ExecutionSnapshot } from '../types';

/** One `call_llm` step frozen out of a snapshot, ready to be re-issued. */
export interface FrozenCall {
  messages: unknown[];
  stepIndex: number;
  /** LLM function definitions visible to the model at this step, if recorded. */
  tools?: unknown[];
}

export interface ModelTarget {
  /** `provider/model` as the user typed it, used for display. */
  label: string;
  model: string;
  provider: string;
}

/**
 * Pick the `call_llm` step to replay. Defaults to the LAST one: a bad answer is
 * almost always the final assistant turn, and earlier steps are usually tool
 * plumbing. `stepIndex` addresses the snapshot's own step numbering, not the
 * position within the `call_llm` subset, so it lines up with `agent-tracing
 * inspect -s <n>`.
 */
export const selectFrozenCall = (
  snapshot: ExecutionSnapshot,
  stepIndex?: number,
): FrozenCall | undefined => {
  const { payloads } = resolvePayloads(snapshot);
  if (payloads.length === 0) return undefined;

  const picked =
    stepIndex === undefined
      ? payloads.at(-1)
      : payloads.find((payload) => payload.stepIndex === stepIndex);
  if (!picked) return undefined;

  return {
    messages: picked.messages,
    stepIndex: picked.stepIndex,
    tools: resolveStepTools(snapshot, picked.stepIndex),
  };
};

/**
 * Tool definitions are recorded on `context.payload.tools`, but only on the
 * steps where the runtime rebuilt them (typically step 0). Walk backwards to
 * the nearest step that carries them so a later step replays with the same
 * toolset the model actually saw.
 */
export const resolveStepTools = (
  snapshot: ExecutionSnapshot,
  stepIndex: number,
): unknown[] | undefined => {
  let tools: unknown[] | undefined;
  for (const step of snapshot.steps) {
    if (step.stepIndex > stepIndex) break;
    const candidate = (step.context?.payload as { tools?: unknown } | undefined)?.tools;
    if (Array.isArray(candidate)) tools = candidate;
  }
  return tools;
};

/** List the `call_llm` step indexes a snapshot can replay, for error messages. */
export const listReplayableSteps = (snapshot: ExecutionSnapshot): number[] =>
  resolvePayloads(snapshot).payloads.map((payload) => payload.stepIndex);

/**
 * Parse `--model a/b,c/d` into provider/model pairs. A bare model name inherits
 * the provider the snapshot ran on, so `--model gpt-5` works when replaying an
 * op that already targeted a provider.
 */
export const parseModelTargets = (spec: string, fallbackProvider?: string): ModelTarget[] => {
  const targets: ModelTarget[] = [];

  for (const raw of spec.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;

    const slash = entry.indexOf('/');
    const provider = slash > 0 ? entry.slice(0, slash) : fallbackProvider;
    const model = slash > 0 ? entry.slice(slash + 1) : entry;

    if (!provider) {
      throw new Error(
        `Cannot resolve a provider for "${entry}" — pass it as "provider/model" ` +
          `(the snapshot does not record one).`,
      );
    }
    if (!model) throw new Error(`Invalid model target: "${entry}"`);

    targets.push({ label: `${provider}/${model}`, model, provider });
  }

  if (targets.length === 0) throw new Error('No model targets provided');
  return targets;
};

export interface BuildReplayRequestParams {
  call: FrozenCall;
  maxTokens?: number;
  target: ModelTarget;
  temperature?: number;
  withTools?: boolean;
}

/**
 * Rebuild the chat request from a frozen call. Everything except the model is
 * carried over verbatim — that is the whole point: the only variable between
 * replays is the model, so a difference in output is attributable to it.
 */
export const buildReplayRequest = ({
  call,
  maxTokens,
  target,
  temperature,
  withTools = true,
}: BuildReplayRequestParams): Record<string, unknown> => {
  const request: Record<string, unknown> = {
    messages: call.messages,
    model: target.model,
    responseMode: 'json',
    stream: false,
  };

  if (withTools && call.tools?.length) request.tools = call.tools;
  if (temperature !== undefined) request.temperature = temperature;
  if (maxTokens !== undefined) request.max_tokens = maxTokens;

  return request;
};

/** Assistant text out of an OpenAI- or Anthropic-shaped completion body. */
export const extractCompletionText = (body: unknown): string => {
  const shaped = body as {
    choices?: Array<{ message?: { content?: unknown } }>;
    content?: Array<{ text?: unknown }>;
  };

  const openai = shaped?.choices?.[0]?.message?.content;
  if (typeof openai === 'string') return openai;

  const anthropic = shaped?.content
    ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
  if (anthropic) return anthropic;

  return '';
};

/** Tool calls requested by the replayed completion, normalized for display. */
export const extractToolCalls = (body: unknown): Array<{ arguments?: string; name: string }> => {
  const calls = (
    body as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string; name?: string } }> };
      }>;
    }
  )?.choices?.[0]?.message?.tool_calls;

  if (!Array.isArray(calls)) return [];

  return calls
    .map((call) => ({ arguments: call.function?.arguments, name: call.function?.name ?? '' }))
    .filter((call) => call.name);
};
