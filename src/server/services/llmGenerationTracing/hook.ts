import {
  computePromptHash,
  resolveScenario,
  type TracingOptions,
} from '@lobechat/llm-generation-tracing';
import type { ModelRuntimeHooks } from '@lobechat/model-runtime';
import debug from 'debug';

import { getLLMGenerationTracingService } from './index';

const log = debug('lobe-server:llm-generation-tracing:hook');

const pickString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Validate the loose `options.tracing` bag (the runtime declares it as
 * `Record<string, unknown>`) into the strongly-typed `TracingOptions` shape
 * the hook works with. Unknown keys flow through `metadata` for the DB jsonb
 * column.
 */
const parseTracingOptions = (raw: Record<string, unknown> | undefined): TracingOptions => {
  if (!raw) return {};
  return {
    agentId: pickString(raw.agentId),
    inputHint: pickString(raw.inputHint),
    metadata:
      raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
    parentTracingId: pickString(raw.parentTracingId),
    promptVersion: pickString(raw.promptVersion),
    scenario: pickString(raw.scenario),
    schemaName: pickString(raw.schemaName),
    systemPrompt: pickString(raw.systemPrompt),
    topicId: pickString(raw.topicId),
    tracingId: pickString(raw.tracingId),
    trigger: pickString(raw.trigger),
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
      const tracing = parseTracingOptions(context.options?.tracing as Record<string, unknown>);
      // `trigger` is also read by ModelRuntime itself (timing logs) so it
      // legitimately lives on `metadata`. Honour the explicit `tracing.trigger`
      // override but fall back to the cross-cutting `metadata.trigger`.
      const metadataTrigger = pickString(
        (context.options?.metadata as Record<string, unknown> | undefined)?.trigger,
      );
      const trigger = tracing.trigger ?? metadataTrigger;
      const { scenario, promptVersion } = resolveScenario({
        promptVersion: tracing.promptVersion,
        scenario: tracing.scenario,
        trigger,
      });

      const systemPrompt = tracing.systemPrompt ?? extractSystemPrompt(context.payload.messages);
      const promptHash = computePromptHash(systemPrompt, context.payload.schema);

      // Heuristic: a Zod validation error message starts with the Zod marker.
      const errorMessage = data.error?.message;
      const validationFailed =
        !data.success && typeof errorMessage === 'string' && /zod|validation/i.test(errorMessage);

      tryScheduleAfter(async () => {
        try {
          await service.record({
            agentId: tracing.agentId,
            costUsd: (data.usage as { cost?: number } | undefined)?.cost,
            errorCode: data.error?.code,
            errorDetail: data.error?.message ?? data.error?.stack,
            inputHint: tracing.inputHint,
            inputTokens: data.usage?.totalInputTokens ?? data.usage?.inputTextTokens,
            latencyMs: data.latencyMs,
            // Caller-supplied jsonb context only. `provider` is already a
            // first-class column on the row — no need to duplicate it here.
            metadata: tracing.metadata,
            model: context.payload.model,
            outputTokens: data.usage?.totalOutputTokens ?? data.usage?.outputTextTokens,
            parentTracingId: tracing.parentTracingId,
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
            schemaName: tracing.schemaName,
            success: data.success,
            topicId: tracing.topicId,
            tracingId: tracing.tracingId,
            trigger,
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
