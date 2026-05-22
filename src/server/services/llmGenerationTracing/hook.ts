import { computePromptHash, resolveScenario } from '@lobechat/llm-generation-tracing';
import type { ModelRuntimeHooks } from '@lobechat/model-runtime';
import debug from 'debug';

import { getLLMGenerationTracingService } from './index';

const log = debug('lobe-server:llm-generation-tracing:hook');

interface TracingMetadata {
  agentId?: string;
  parentTracingId?: string;
  promptVersion?: string;
  scenario?: string;
  schemaName?: string;
  /** Override for the system prompt used in hash computation; defaults to messages[0]. */
  systemPromptOverride?: string;
  topicId?: string;
  trigger?: string;
}

const KNOWN_METADATA_KEYS = new Set([
  'agentId',
  'parentTracingId',
  'promptVersion',
  'scenario',
  'schemaName',
  'systemPrompt',
  'topicId',
  'trigger',
  // ModelRuntime-internal metadata that should never bleed into the tracing row.
  'provider',
  'userId',
  'traceId',
  'spanId',
]);

/**
 * Reads tracing metadata from options.metadata. Recognised keys map to the
 * tracing schema; everything else (e.g. `parent_memory_trace_key`) is preserved
 * verbatim under `passthrough` so callers can scribble custom context into the
 * row's `metadata` jsonb without round-tripping through the registry.
 */
const extractMetadata = (
  metadata: Record<string, unknown> | undefined,
): TracingMetadata & { passthrough: Record<string, unknown> } => {
  if (!metadata) return { passthrough: {} };
  const passthrough: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!KNOWN_METADATA_KEYS.has(k)) passthrough[k] = v;
  }
  return {
    agentId: typeof metadata.agentId === 'string' ? metadata.agentId : undefined,
    parentTracingId:
      typeof metadata.parentTracingId === 'string' ? metadata.parentTracingId : undefined,
    passthrough,
    promptVersion: typeof metadata.promptVersion === 'string' ? metadata.promptVersion : undefined,
    scenario: typeof metadata.scenario === 'string' ? metadata.scenario : undefined,
    schemaName: typeof metadata.schemaName === 'string' ? metadata.schemaName : undefined,
    systemPromptOverride:
      typeof metadata.systemPrompt === 'string' ? (metadata.systemPrompt as string) : undefined,
    topicId: typeof metadata.topicId === 'string' ? metadata.topicId : undefined,
    trigger: typeof metadata.trigger === 'string' ? metadata.trigger : undefined,
  };
};

const extractSystemPrompt = (messages: unknown): string => {
  if (!Array.isArray(messages)) return '';
  const first = messages[0] as { content?: unknown; role?: unknown } | undefined;
  if (first?.role === 'system' && typeof first.content === 'string') return first.content;
  return '';
};

const tryScheduleAfter = (work: () => Promise<void> | void): void => {
  let scheduled = false;
  try {
    const nextServer = require('next/server') as { after?: (fn: () => unknown) => void };
    if (typeof nextServer.after === 'function') {
      nextServer.after(work);
      scheduled = true;
    }
  } catch {
    // next/server not available — fall through to fire-and-forget
  }
  if (!scheduled) {
    Promise.resolve()
      .then(work)
      .catch((err) => log('Deferred tracing work threw: %O', err));
  }
};

/**
 * Build a `ModelRuntimeHooks` slice that records every `generateObject` call to
 * the `llm_generation_tracing` DB table + blob store. Designed to be merged
 * with any business hooks at the ModelRuntime construction site.
 */
export const createLLMGenerationTracingHook = (
  userId: string,
  provider: string,
): Pick<ModelRuntimeHooks, 'onGenerateObjectComplete'> => {
  const service = getLLMGenerationTracingService();
  if (!service.isEnabled()) return {};

  return {
    onGenerateObjectComplete: (data, context) => {
      const meta = extractMetadata(context.options?.metadata as Record<string, unknown>);
      const { scenario, promptVersion } = resolveScenario({
        promptVersion: meta.promptVersion,
        scenario: meta.scenario,
        trigger: meta.trigger,
      });

      const systemPrompt =
        meta.systemPromptOverride ?? extractSystemPrompt(context.payload.messages);
      const promptHash = computePromptHash(systemPrompt, context.payload.schema);

      // Heuristic: a Zod validation error message starts with the Zod marker.
      const errorMessage = data.error?.message;
      const validationFailed =
        !data.success && typeof errorMessage === 'string' && /zod|validation/i.test(errorMessage);

      tryScheduleAfter(async () => {
        try {
          await service.record({
            agentId: meta.agentId,
            costUsd: (data.usage as { cost?: number } | undefined)?.cost,
            errorCode: data.error?.code,
            errorDetail: data.error?.message ?? data.error?.stack,
            inputTokens: data.usage?.totalInputTokens ?? data.usage?.inputTextTokens,
            latencyMs: data.latencyMs,
            metadata: { ...meta.passthrough, provider },
            model: context.payload.model,
            outputTokens: data.usage?.totalOutputTokens ?? data.usage?.outputTextTokens,
            parentTracingId: meta.parentTracingId,
            payload: {
              input: context.payload.messages,
              output: data.output,
              schema: context.payload.schema,
              systemPrompt,
            },
            promptHash,
            promptVersion,
            provider,
            scenario,
            schemaName: meta.schemaName,
            success: data.success,
            topicId: meta.topicId,
            trigger: meta.trigger,
            userId,
            validationFailed,
          });
        } catch (err) {
          log('Tracing service threw: %O', err);
        }
      });
    },
  };
};

/**
 * Merge two `ModelRuntimeHooks` instances, chaining handlers of the same key so
 * both fire (business first, then tracing). Returns `undefined` only when both
 * inputs are empty.
 */
export const mergeModelRuntimeHooks = (
  a?: ModelRuntimeHooks,
  b?: ModelRuntimeHooks,
): ModelRuntimeHooks | undefined => {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;

  const merged: ModelRuntimeHooks = { ...a };

  for (const key of Object.keys(b) as (keyof ModelRuntimeHooks)[]) {
    const existing = merged[key];
    const next = b[key];
    if (!existing) {
      (merged[key] as unknown) = next;
      continue;
    }
    (merged[key] as unknown) = async (...args: unknown[]) => {
      // Run business hook first, then tracing — tracing failures must never
      // shadow the business-side decision (billing throws are load-bearing).
      await (existing as (...args: unknown[]) => Promise<unknown>)(...args);
      await (next as (...args: unknown[]) => Promise<unknown>)(...args);
    };
  }

  return merged;
};
