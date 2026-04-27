import { metrics, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-agent-signal');

/**
 * AgentSignal tracer used for runtime chain observability spans.
 *
 * Use when:
 * - Server-side AgentSignal execution persists span events for one semantic chain
 * - AgentSignal service code needs stable OTEL ownership outside feature-local modules
 *
 * Expects:
 * - Tracing may be disabled, in which case the active provider behaves as a no-op
 *
 * @returns Shared tracer for AgentSignal runtime observability
 */
export const tracer = trace.getTracer('@lobechat/agent-signal', '0.0.1');

/**
 * Count of persisted AgentSignal source occurrences.
 */
export const sourceCounter = meter.createCounter('agent_signal_source_occurrences_total', {
  description: 'Count of AgentSignal source events persisted to telemetry.',
  unit: '{source}',
});

/**
 * Count of persisted AgentSignal signal occurrences grouped by signal type.
 */
export const signalCounter = meter.createCounter('agent_signal_signal_occurrences_total', {
  description: 'Count of AgentSignal signal occurrences persisted to telemetry.',
  unit: '{signal}',
});

/**
 * Count of persisted AgentSignal action occurrences grouped by action type.
 */
export const actionCounter = meter.createCounter('agent_signal_action_occurrences_total', {
  description: 'Count of AgentSignal action occurrences persisted to telemetry.',
  unit: '{action}',
});

/**
 * Count of persisted AgentSignal action results grouped by result status.
 */
export const actionResultCounter = meter.createCounter('agent_signal_action_results_total', {
  description: 'Count of AgentSignal action results persisted to telemetry.',
  unit: '{result}',
});

/**
 * Count of persisted AgentSignal chains.
 */
export const chainCounter = meter.createCounter('agent_signal_chains_total', {
  description: 'Count of projected AgentSignal chains persisted to telemetry.',
  unit: '{chain}',
});

/**
 * Count of signal to action transitions observed inside AgentSignal chains.
 */
export const signalActionTransitionCounter = meter.createCounter(
  'agent_signal_signal_action_transitions_total',
  {
    description: 'Count of AgentSignal signal to action transitions persisted to telemetry.',
    unit: '{transition}',
  },
);

/**
 * Duration histogram for one AgentSignal chain summary.
 */
export const chainDurationHistogram = meter.createHistogram('agent_signal_chain_duration_ms', {
  description: 'Observed duration for one AgentSignal chain summary.',
  unit: 'ms',
});

/**
 * Duration histogram for one AgentSignal action attempt.
 */
export const actionDurationHistogram = meter.createHistogram('agent_signal_action_duration_ms', {
  description: 'Observed duration for one AgentSignal action attempt.',
  unit: 'ms',
});
