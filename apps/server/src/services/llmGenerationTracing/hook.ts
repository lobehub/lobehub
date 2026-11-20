import {
  computePromptHash,
  resolveScenario,
  type TracingOptions,
} from '@lobechat/llm-generation-tracing';
import { describeGenerateObjectError, type ModelRuntimeHooks } from '@lobechat/model-runtime';
import debug from 'debug';

import { after } from '@/server/utils/scheduleAfterResponse';

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

interface CallToRecord {
  costUsd?: number;
  error?: { code?: string; message?: string; stack?: string };
  input: unknown;
  latencyMs?: number;
  model?: string;
  /** The loose `options.tracing` bag plus `options.metadata`, as the caller passed them. */
  options?: { metadata?: Record<string, unknown>; tracing?: Record<string, unknown> };
  output?: unknown;
  /** What the call asked: a JSON schema (`generateObject`) or the questions (a decision). */
  schema?: unknown;
  success: boolean;
  systemPrompt?: string;
  usage?: { cost?: number; totalInputTokens?: number; totalOutputTokens?: number } & Record<
    string,
    unknown
  >;
}

/**
 * Build a `ModelRuntimeHooks` slice that records every `generateObject` and decision call to
 * the `llm_generation_tracing` DB table + blob store. Designed to be merged
 * with any business hooks at the ModelRuntime construction site.
 */
export const createLLMGenerationTracingHook = (
  userId: string,
  provider: string,
  workspaceId?: string,
): Pick<ModelRuntimeHooks, 'onDecideError' | 'onDecideFinal' | 'onGenerateObjectComplete'> => {
  const service = getLLMGenerationTracingService();
  if (!service.isEnabled()) return {};

  const schedule = (call: CallToRecord) => {
    const tracing = parseTracingOptions(call.options?.tracing);
    // `trigger` is also read by ModelRuntime itself (timing logs) so it
    // legitimately lives on `metadata`. Honour the explicit `tracing.trigger`
    // override but fall back to the cross-cutting `origin.trigger`.
    const metadataTrigger = pickString(call.options?.metadata?.trigger);
    const trigger = tracing.trigger ?? metadataTrigger;
    const { scenario, promptVersion } = resolveScenario({
      promptVersion: tracing.promptVersion,
      scenario: tracing.scenario,
      trigger,
    });

    const systemPrompt = tracing.systemPrompt ?? call.systemPrompt ?? '';
    const promptHash = computePromptHash(systemPrompt, call.schema);

    // Heuristic: a Zod validation error message starts with the Zod marker.
    const errorMessage = call.error?.message;
    const validationFailed =
      !call.success && typeof errorMessage === 'string' && /zod|validation/i.test(errorMessage);

    // In-process completion callback (not persisted): lets a caller late-bind
    // a hard FK onto the tracing row, which only exists after this deferred
    // record() commits. Carried on the raw `tracing` bag, so it survives
    // `parseTracingOptions` (which keeps only serializable string fields).
    const rawTracing = call.options?.tracing ?? {};
    const onPersisted =
      typeof rawTracing.onPersisted === 'function'
        ? (rawTracing.onPersisted as (tracingId: string | null) => void | Promise<void>)
        : undefined;

    after(async () => {
      let persistedTracingId: string | null = null;
      try {
        const result = await service.record({
          agentId: tracing.agentId,
          costUsd: call.costUsd ?? call.usage?.cost,
          errorCode: call.error?.code,
          errorDetail: call.error?.message ?? call.error?.stack,
          inputHint: tracing.inputHint,
          inputTokens: call.usage?.totalInputTokens ?? (call.usage?.inputTextTokens as number),
          latencyMs: call.latencyMs,
          // Caller-supplied jsonb context only. `provider` is already a
          // first-class column on the row — no need to duplicate it here.
          metadata: tracing.metadata,
          model: call.model,
          outputTokens: call.usage?.totalOutputTokens ?? (call.usage?.outputTextTokens as number),
          parentTracingId: tracing.parentTracingId,
          payload: {
            input: call.input,
            output: call.output,
            schema: call.schema,
            systemPrompt,
          },
          promptHash,
          promptVersion,
          provider,
          scenario,
          schemaName: tracing.schemaName,
          success: call.success,
          topicId: tracing.topicId,
          tracingId: tracing.tracingId,
          trigger,
          userId,
          validationFailed,
          workspaceId,
        });
        persistedTracingId = result?.tracingId ?? null;
      } catch (err) {
        log('Tracing service threw: %O', err);
      }

      // Signal completion after the row is committed (or null if it wasn't),
      // so the caller's backfill never references a non-existent row.
      if (onPersisted) {
        try {
          await onPersisted(persistedTracingId);
        } catch (err) {
          log('onPersisted callback threw: %O', err);
        }
      }
    });
  };

  return {
    // A decision has no system prompt: its "prompt" is the questions, which is what the hash and
    // the schema column carry, and the shared state is the input.
    onDecideError: (error, context) =>
      schedule({
        error: {
          code: pickString((error as { errorType?: unknown }).errorType),
          message: describeGenerateObjectError(error as { error?: unknown; message?: string }),
        },
        input: { state: context.payload.state },
        model: context.payload.model,
        options: context.options,
        schema: context.payload.questions,
        success: false,
      }),
    onDecideFinal: (data, context) =>
      schedule({
        // What the provider charged beats the price-table estimate.
        costUsd: data.providerReportedCost,
        input: { state: context.payload.state },
        latencyMs: data.latencyMs,
        model: context.payload.model,
        options: context.options,
        output: data.response.answers,
        schema: context.payload.questions,
        success: true,
        usage: data.usage as CallToRecord['usage'],
      }),
    onGenerateObjectComplete: (data, context) =>
      schedule({
        error: data.error,
        input: context.payload.messages,
        latencyMs: data.latencyMs,
        model: context.payload.model,
        options: context.options,
        output: data.output,
        schema: context.payload.schema,
        success: data.success,
        systemPrompt: extractSystemPrompt(context.payload.messages),
        usage: data.usage as CallToRecord['usage'],
      }),
  };
};
