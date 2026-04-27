/** Server-owned Redis key prefix for AgentSignal storage adapters. */
export const AGENT_SIGNAL_PREFIX = 'agent-signal:';

/** Server-owned Redis key builders for AgentSignal adapters. */
export const AGENT_SIGNAL_KEYS = {
  dedupe: (id: string) => `${AGENT_SIGNAL_PREFIX}dedupe:${id}`,
  lock: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}lock:${scopeKey}`,
  policy: (policyId: string, scopeKey: string) =>
    `${AGENT_SIGNAL_PREFIX}policy:${policyId}:${scopeKey}`,
  waypoint: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}waypoint:${scopeKey}`,
  waypointEvents: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}waypoint:${scopeKey}:events`,
  window: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}window:${scopeKey}`,
} as const;

/** Server-owned timing defaults for AgentSignal storage and generation. */
export const AGENT_SIGNAL_DEFAULTS = {
  generationLockTtlSeconds: 5,
  runtimeGuardTtlSeconds: 3600,
  runtimeWaypointTtlSeconds: 3600,
  signalDedupeTtlSeconds: 300,
  signalWindowTtlSeconds: 3600,
} as const;

/** Server-owned runtime backend identifiers. */
export const AGENT_SIGNAL_RUNTIME_BACKENDS = {
  memory: 'memory',
} as const;
