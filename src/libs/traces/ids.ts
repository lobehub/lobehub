import { createHash } from 'node:crypto';

const TRACE_ID_PATTERN = /^[\da-f]{32}$/;
const SPAN_ID_PATTERN = /^[\da-f]{16}$/;
const SAMPLED = 1;

export const isOtelTraceId = (id?: string | null): id is string =>
  !!id && TRACE_ID_PATTERN.test(id) && !/^0+$/.test(id);

export const isOtelSpanId = (id?: string | null): id is string =>
  !!id && SPAN_ID_PATTERN.test(id) && !/^0+$/.test(id);

/**
 * OpenTelemetry trace id for a trace id that LobeHub already handed to the client.
 *
 * Ids issued since the SDK v5 migration are OTel trace ids and are kept as they are. Older ids
 * (UUIDs from SDK v3) are hashed the same way as `createTraceId(seed)` in `@langfuse/tracing`,
 * so every step that reuses one of them lands in the same trace.
 */
export const toOtelTraceId = (id: string): string =>
  isOtelTraceId(id) ? id : createHash('sha256').update(id).digest('hex').slice(0, 32);

/**
 * Parent context for observations added to a trace that an earlier request started.
 * When the parent observation id is unknown, a span id derived from the trace id is used, as in
 * the Langfuse docs for custom trace ids.
 */
export const remoteParent = (traceId: string, observationId?: string | null) => ({
  isRemote: true,
  spanId: isOtelSpanId(observationId) ? observationId : traceId.slice(16),
  traceFlags: SAMPLED,
  traceId,
});
