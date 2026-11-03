import { metrics, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-agent-runtime');

/**
 * Tracer for Agent Runtime semantic spans (invoke_agent / chat / execute_tool /
 * context_engineering). Shared across `AgentRuntimeService`, `RuntimeExecutors`,
 * and the server-side `serverMessagesEngine`.
 *
 * When OTEL is not initialized, `getTracer` returns a no-op provider, so calling
 * `tracer.startActiveSpan` is safe and cheap in environments without telemetry.
 */
export const tracer = trace.getTracer('@lobechat/agent-runtime', '0.0.1');

/**
 * Count of async sub-agent parent resume attempts grouped by `outcome`:
 * - `resumed`         — won the resume CAS and scheduled the parent's next step
 * - `barrier_held`    — pending tools not all fulfilled yet, re-check armed
 * - `no_pending`      — parked op had no pending tools (snapshot lag), fallback armed
 * - `no_state`        — parent state missing/expired in Redis, cannot resume
 * - `lost_cas`        — another completion won the resume CAS first
 * - `verify_exhausted`— bounded watchdog retries exhausted while still not resumable
 *
 * Lets orphaned `waiting_for_async_tool` parents be detected via the
 * `barrier_held` / `no_pending` / `verify_exhausted` series instead of
 * accumulating silently. For details see: async sub-agent suspend/resume stability hardening — bounded watchdog retry with exponential backoff.
 */
export const asyncToolResumeCounter = meter.createCounter('agent_runtime_async_tool_resume_total', {
  description: 'Count of async sub-agent parent resume attempts grouped by outcome.',
  unit: '{resume}',
});

export * from './attributes';
export * from './semconv';
