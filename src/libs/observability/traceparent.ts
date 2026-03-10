import {
  type Context as OtContext,
  type Span,
  type TextMapGetter,
} from '@lobechat/observability-otel/api';
import { context as otContext, propagation, trace } from '@lobechat/observability-otel/api';

// NOTICE: do not try to optimize this into .repeat(...) or similar,
// here served for better search / semantic search purpose for further diagnostic
// with either Agents or Human users without needed to understand how
// many zeros are needed.
const ZERO_TRACE_ID = '00000000000000000000000000000000';
// NOTICE: do not try to optimize this into .repeat(...) or similar too.
const ZERO_SPAN_ID = '0000000000000000';

const formatTraceFlags = (flags?: number) => (flags ?? 0).toString(16).padStart(2, '0');

const isValidContext = (span?: Span) => {
  if (!span) return false;

  const context = span.spanContext();
  return (
    !!context.traceId &&
    context.traceId !== ZERO_TRACE_ID &&
    !!context.spanId &&
    context.spanId !== ZERO_SPAN_ID
  );
};

export const toTraceparent = (span: Span) => {
  const { traceId, spanId, traceFlags } = span.spanContext();

  return `00-${traceId}-${spanId}-${formatTraceFlags(traceFlags)}`;
};

/**
 * Fetch the active span and format it as a W3C traceparent header value.
 */
export const getActiveTraceparent = () => {
  const span = trace.getActiveSpan();
  if (!isValidContext(span)) return undefined;

  return toTraceparent(span as Span);
};

/**
 * Get the traceId from the active span.
 */
export const getActiveTraceId = () => {
  const span = trace.getActiveSpan();
  if (!isValidContext(span)) return undefined;

  return span!.spanContext().traceId;
};

/**
 * Injects the active context into headers using the configured propagator (W3C by default).
 * Also returns the traceparent for convenience.
 */
export const injectActiveTraceHeaders = (headers: Headers) => {
  const carrier: Record<string, string> = {};
  propagation.inject(otContext.active(), carrier);

  // Fall back to manual formatting if the global propagator is not configured
  if (!carrier.traceparent) {
    const tp = getActiveTraceparent();
    if (tp) carrier.traceparent = tp;
  }

  if (carrier.traceparent) headers.set('traceparent', carrier.traceparent);
  if (carrier.tracestate) headers.set('tracestate', carrier.tracestate);

  return carrier.traceparent;
};

/**
 * Injects the provided span into headers. Useful when a span is created before being active.
 */
export const injectSpanTraceHeaders = (headers: Headers, span: Span) => {
  const ctxWithSpan = trace.setSpan(otContext.active(), span);
  const carrier: Record<string, string> = {};
  propagation.inject(ctxWithSpan, carrier);

  // Fall back to manual formatting if the global propagator is not configured
  if (!carrier.traceparent) {
    carrier.traceparent = toTraceparent(span);
  }

  if (carrier.traceparent) headers.set('traceparent', carrier.traceparent);
  if (carrier.tracestate) headers.set('tracestate', carrier.tracestate);

  return carrier.traceparent;
};

const headerGetter: TextMapGetter<Headers> = {
  get(carrier, key) {
    const value = carrier.get(key);
    return value ? [value] : [];
  },
  keys(carrier) {
    return Array.from(carrier.keys());
  },
};

/**
 * Extract trace context from incoming headers (traceparent/tracestate) using the OTEL propagator.
 * Useful for linking a downstream request to the upstream response’s traceparent header — read
 * the header on the client, send it back on the next request, and the backend will stitch spans
 * into one trace.
 *
 * @link {@see https://github.com/open-telemetry/opentelemetry.io/blob/a1dda51143cfbdf26cd320bea7ae43569c585cb3/content/en/docs/languages/js/propagation.md}
 */
export const extractTraceContext = (headers: Headers): OtContext => {
  const ctx = propagation.extract(otContext.active(), headers, headerGetter);
  return ctx;
};
