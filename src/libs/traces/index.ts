import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { createTraceId } from '@langfuse/tracing';
import { CURRENT_VERSION } from '@lobechat/const';
import { isValidSpanId, isValidTraceId, type SpanContext, TraceFlags } from '@opentelemetry/api';

import { getLangfuseConfig } from '@/envs/langfuse';

let client: LangfuseClient | undefined;
let spanProcessor: LangfuseSpanProcessor | undefined;

const getCredentials = () => {
  const { ENABLE_LANGFUSE, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST } =
    getLangfuseConfig();
  if (!ENABLE_LANGFUSE) return;

  if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
    throw new TypeError('NO_LANGFUSE_KEY_ERROR');
  }

  return {
    baseUrl: LANGFUSE_HOST,
    publicKey: LANGFUSE_PUBLIC_KEY,
    secretKey: LANGFUSE_SECRET_KEY,
  };
};

export const getLangfuseClient = () => {
  const credentials = getCredentials();
  if (!credentials) return;
  client ??= new LangfuseClient(credentials);
  return client;
};

export const getLangfuseSpanProcessor = () => {
  const credentials = getCredentials();
  if (!credentials) return;
  spanProcessor ??= new LangfuseSpanProcessor({
    ...credentials,
    release: CURRENT_VERSION,
    // Other gen_ai instrumentation does not participate in the chat telemetry opt-in.
    shouldExportSpan: ({ otelSpan }) => otelSpan.instrumentationScope.name === 'langfuse-sdk',
  });
  return spanProcessor;
};

/** Preserve W3C IDs; map legacy/custom IDs deterministically for new observations. */
export const getTraceContext = async (
  traceId?: string,
  observationId?: string,
): Promise<SpanContext | undefined> => {
  if (!traceId) return;
  return {
    spanId: observationId && isValidSpanId(observationId) ? observationId : '0000000000000001',
    traceFlags: TraceFlags.SAMPLED,
    traceId: isValidTraceId(traceId) ? traceId : await createTraceId(traceId),
  };
};

/** Flush after each response without shutting down the process-wide OTel provider. */
export const flushTraces = async () => {
  await Promise.all([spanProcessor?.forceFlush(), client?.flush()]);
};
