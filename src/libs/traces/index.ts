import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  type LangfuseGeneration,
  type LangfuseGenerationAttributes,
  LangfuseOtelSpanAttributes,
  type LangfuseSpan,
  type LangfuseSpanAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from '@langfuse/tracing';
import { CURRENT_VERSION } from '@lobechat/const';
import { AlwaysOnSampler, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

import { getLangfuseConfig } from '@/envs/langfuse';
import { TraceEventClient } from '@/libs/traces/event';

import { remoteParent, toOtelTraceId } from './ids';

interface LangfuseRuntime {
  client: LangfuseClient;
  configKey: string;
  processor: LangfuseSpanProcessor;
}

let runtime: LangfuseRuntime | undefined;

/**
 * One span processor, tracer provider and API client per process.
 *
 * The tracer provider is registered only with the Langfuse SDK, not as the global OpenTelemetry
 * provider. Langfuse tracing therefore works whether or not ENABLE_TELEMETRY starts the app's own
 * OpenTelemetry SDK, and the app's HTTP and Postgres spans are not sent to Langfuse.
 *
 * Chat requests run inside the incoming trace context (see the auth middleware), so a parent-based
 * sampler would drop a chat whose `traceparent` is unsampled. Langfuse samples every observation.
 */
const getRuntime = (config: { baseUrl: string; publicKey: string; secretKey: string }) => {
  const configKey = [config.baseUrl, config.publicKey, config.secretKey].join('\n');
  if (runtime?.configKey === configKey) return runtime;

  const processor = new LangfuseSpanProcessor({ ...config, release: CURRENT_VERSION });
  setLangfuseTracerProvider(
    new BasicTracerProvider({ sampler: new AlwaysOnSampler(), spanProcessors: [processor] }),
  );

  runtime = { client: new LangfuseClient(config), configKey, processor };
  return runtime;
};

export interface CreateTraceParams {
  /** Trace id returned to the client by an earlier request, to add this request to that trace */
  id?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  name?: string;
  sessionId?: string;
  tags?: string[];
  userId?: string;
}

type TraceAttributes = Record<string, string | string[]>;

/**
 * A chat trace: one root observation, with trace attributes (user, session, tags, name) set on
 * the root and on every child, as Langfuse v4 reads them from each observation.
 */
export class LangfuseTrace {
  private readonly children: LangfuseGeneration[] = [];

  constructor(
    private readonly root: LangfuseSpan,
    private readonly attributes: TraceAttributes,
  ) {
    root.otelSpan.setAttributes(attributes);
  }

  get id() {
    return this.root.traceId;
  }

  generation(name: string, attributes: LangfuseGenerationAttributes) {
    const generation = this.root.startObservation(name, attributes, { asType: 'generation' });
    generation.otelSpan.setAttributes(this.attributes);
    this.children.push(generation);
    return generation;
  }

  setTags(tags: string[]) {
    this.attributes[LangfuseOtelSpanAttributes.TRACE_TAGS] = tags;

    for (const observation of [this.root, ...this.children]) {
      if (observation.otelSpan.isRecording()) {
        observation.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_TAGS, tags);
      }
    }
  }

  update(attributes: LangfuseSpanAttributes) {
    if (this.root.otelSpan.isRecording()) this.root.update(attributes);
  }

  /** Ends every observation that is still open. Spans are exported only once they end. */
  end() {
    for (const observation of [...this.children, this.root]) {
      if (observation.otelSpan.isRecording()) observation.end();
    }
  }
}

/**
 * We use langfuse as the tracing system to trace the request and response
 */
export class TraceClient {
  private _runtime?: LangfuseRuntime;

  constructor() {
    const { ENABLE_LANGFUSE, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST } =
      getLangfuseConfig();

    if (!ENABLE_LANGFUSE) return;

    // when enabled langfuse, make sure the key are ready in envs
    if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
      console.info('-----');
      console.error(
        "You are enabling langfuse but don't set the `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY`. Please check your env",
      );

      throw new TypeError('NO_LANGFUSE_KEY_ERROR');
    }

    this._runtime = getRuntime({
      baseUrl: LANGFUSE_HOST,
      publicKey: LANGFUSE_PUBLIC_KEY,
      secretKey: LANGFUSE_SECRET_KEY,
    });
  }

  createEvent(traceId: string) {
    if (!this._runtime) return;

    return new TraceEventClient({ client: this._runtime.client, traceId });
  }

  createTrace({ id, input, metadata, name, sessionId, tags, userId }: CreateTraceParams) {
    if (!this._runtime) return;

    const attributes: TraceAttributes = {};
    if (name) attributes[LangfuseOtelSpanAttributes.TRACE_NAME] = name;
    if (userId) attributes[LangfuseOtelSpanAttributes.TRACE_USER_ID] = userId;
    if (sessionId) attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID] = sessionId;
    if (tags?.length) attributes[LangfuseOtelSpanAttributes.TRACE_TAGS] = tags;

    const root = startObservation(
      name || 'chat',
      { input, metadata },
      id ? { parentSpanContext: remoteParent(toOtelTraceId(id)) } : undefined,
    );

    return new LangfuseTrace(root, attributes);
  }

  /**
   * Sends everything recorded so far. Call it after the response, so that serverless runtimes
   * export spans and scores before the instance is frozen.
   */
  async flush() {
    if (!this._runtime) return;

    await Promise.all([this._runtime.processor.forceFlush(), this._runtime.client.flush()]);
  }
}
