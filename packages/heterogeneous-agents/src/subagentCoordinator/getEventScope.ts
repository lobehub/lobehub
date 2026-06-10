import type { SubagentEventContext } from '../types';

/**
 * Classify a stream event's scope. The adapter stamps `data.subagent` (a
 * {@link SubagentEventContext}) on every event originating from a subagent
 * turn; main-agent events leave it undefined.
 *
 * Accepts a structural event (`{ type, data }`) so it works for both the
 * package's `HeterogeneousAgentEvent` and the wire `AgentStreamEvent` without a
 * cross-package type dependency.
 */
export type EventScope = { kind: 'main' } | { ctx: SubagentEventContext; kind: 'subagent' };

export const getEventScope = (event: { data?: any }): EventScope => {
  const ctx = event?.data?.subagent as SubagentEventContext | undefined;
  if (ctx && typeof ctx.parentToolCallId === 'string') {
    return { ctx, kind: 'subagent' };
  }
  return { kind: 'main' };
};
