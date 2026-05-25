import { trace } from '@opentelemetry/api';

/**
 * Tracer for Agent Runtime semantic spans (invoke_agent / chat / execute_tool /
 * context_engineering). Shared across `AgentRuntimeService`, `RuntimeExecutors`,
 * and the server-side `serverMessagesEngine`.
 *
 * When OTEL is not initialized, `getTracer` returns a no-op provider, so calling
 * `tracer.startActiveSpan` is safe and cheap in environments without telemetry.
 */
export const tracer = trace.getTracer('@lobechat/agent-runtime', '0.0.1');

export * from './attributes';
export * from './semconv';
