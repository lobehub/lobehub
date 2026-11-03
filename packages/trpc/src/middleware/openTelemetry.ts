import { env } from 'node:process';

import { type Attributes, type Span } from '@lobechat/observability-otel/api';
import { context, diag, SpanKind, SpanStatusCode, trace } from '@lobechat/observability-otel/api';
import {
  ATTR_ERROR_TYPE,
  ATTR_EXCEPTION_MESSAGE,
  ATTR_EXCEPTION_STACKTRACE,
  createAttributesForMetrics,
  DEFAULT_ERROR_CODE,
  DEFAULT_SUCCESS_STATUS,
  getPayloadSize,
  serverDurationHistogram,
  serverRequestSizeHistogram,
  serverRequestsPerRpcHistogram,
  serverResponseSizeHistogram,
  serverResponsesPerRpcHistogram,
  TRPCAttribute,
  tRPCConventionFromPathAndType,
} from '@lobechat/observability-otel/trpc';
import { TRPCError } from '@trpc/server';

import { injectSpanTraceHeaders } from '@/libs/observability/traceparent';

import { name } from '../../../../package.json';
import { trpc } from '../lambda/init';

const tracer = trace.getTracer('trpc-server');

const recordRpcServerMetrics = ({
  attributes,
  durationMs,
  requestSize,
  responseSize,
}: {
  attributes: Attributes;
  durationMs: number;
  requestSize?: number;
  responseSize?: number;
}) => {
  serverDurationHistogram.record(durationMs, attributes);
  serverRequestsPerRpcHistogram.record(1, attributes);
  serverResponsesPerRpcHistogram.record(1, attributes);

  if (typeof requestSize === 'number') {
    serverRequestSizeHistogram.record(requestSize, attributes);
  }

  if (typeof responseSize === 'number') {
    serverResponseSizeHistogram.record(responseSize, attributes);
  }
};

const finalizeSpanWithError = (span: Span, error: unknown) => {
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : 'Unknown error',
  });

  if (error instanceof Error) {
    span.recordException(error);
    span.setAttribute(ATTR_ERROR_TYPE, error.constructor.name);
    span.setAttribute(ATTR_EXCEPTION_MESSAGE, error.message);
    span.setAttribute(ATTR_EXCEPTION_STACKTRACE, error.stack || '');
  }
};

export const openTelemetry = trpc.middleware(async ({ ctx, path, type, next, getRawInput }) => {
  if (!env.ENABLE_TELEMETRY) {
    diag.debug(name, 'telemetry disabled', env.ENABLE_TELEMETRY);

    return next();
  }

  diag.debug(name, 'tRPC instrumentation', 'incomingRequest');

  const spanName = `tRPC ${type.toUpperCase()} ${path}`;
  const baseAttributes = tRPCConventionFromPathAndType(path, type);
  const input = getRawInput();
  const requestSize = getPayloadSize(input);

  const span = tracer.startSpan(
    spanName,
    {
      attributes: baseAttributes,
      kind: SpanKind.SERVER,
    },
    ctx?.traceContext,
  );

  // attach trace headers for downstream consumers (traceparent/tracestate)
  if (ctx?.resHeaders) {
    injectSpanTraceHeaders(ctx.resHeaders, span);
  }

  const startTimestamp = Date.now();

  try {
    const result = await context.with(trace.setSpan(context.active(), span), async () => next());
    diag.debug(name, 'tRPC instrumentation', 'requestHandled');

    const responseSize = getPayloadSize(result.ok ? result.data : result.error);

    const durationMs = Date.now() - startTimestamp;
    const statusCode = result.ok ? DEFAULT_SUCCESS_STATUS : result.error.code;
    span.setAttribute(TRPCAttribute.RPC_TRPC_STATUS_CODE, statusCode);

    if (result.ok) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      finalizeSpanWithError(span, result.error);
    }

    recordRpcServerMetrics({
      attributes: createAttributesForMetrics(baseAttributes, statusCode, {
        [TRPCAttribute.RPC_TRPC_SUCCESS]: result.ok,
        ...(result.ok ? undefined : { [ATTR_ERROR_TYPE]: result.error.code }),
      }),
      durationMs,
      requestSize,
      responseSize,
    });

    diag.debug(name, 'tRPC instrumentation', 'metrics recorded');

    return result;
  } catch (error) {
    diag.error(name, 'tRPC instrumentation', 'requestError', error);

    const durationMs = Date.now() - startTimestamp;
    const trpcError = error instanceof TRPCError ? error : undefined;
    const statusCode = trpcError ? trpcError.code : DEFAULT_ERROR_CODE;

    span.setAttribute(TRPCAttribute.RPC_TRPC_STATUS_CODE, statusCode);
    finalizeSpanWithError(span, error);

    recordRpcServerMetrics({
      attributes: createAttributesForMetrics(baseAttributes, statusCode, {
        [TRPCAttribute.RPC_TRPC_SUCCESS]: false,
        ...(trpcError ? { [ATTR_ERROR_TYPE]: trpcError.code } : undefined),
      }),
      durationMs,
      requestSize,
      responseSize: getPayloadSize(trpcError ? trpcError : error),
    });

    diag.error(name, 'tRPC instrumentation', 'metrics recorded with error', error);

    throw error;
  } finally {
    span.end();
  }
});
