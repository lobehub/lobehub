/** Server-owned Redis key prefix for AgentSignal storage adapters. */
export const AGENT_SIGNAL_PREFIX = 'agent-signal:';

/** Server-owned Redis key builders for AgentSignal adapters. */
export const AGENT_SIGNAL_KEYS = {
  dedupe: (id: string) => `${AGENT_SIGNAL_PREFIX}dedupe:${id}`,
  lock: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}lock:${scopeKey}`,
  policy: (policyId: string, scopeKey: string) =>
    `${AGENT_SIGNAL_PREFIX}policy:${policyId}:${scopeKey}`,
  receipt: (receiptId: string) => `${AGENT_SIGNAL_PREFIX}receipt:${receiptId}`,
  receiptDedupe: (receiptId: string) => `${AGENT_SIGNAL_PREFIX}receipt-dedupe:${receiptId}`,
  receiptIndex: (input: { agentId: string; topicId: string; userId: string }) =>
    `${AGENT_SIGNAL_PREFIX}receipts:user:${input.userId}:agent:${input.agentId}:topic:${input.topicId}`,
  waypoint: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}waypoint:${scopeKey}`,
  waypointEvents: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}waypoint:${scopeKey}:events`,
  window: (scopeKey: string) => `${AGENT_SIGNAL_PREFIX}window:${scopeKey}`,
} as const;

/** Server-owned timing defaults for AgentSignal storage and generation. */
export const AGENT_SIGNAL_DEFAULTS = {
  /**
   * Per-user, per-UTC-day ceiling on feedback satisfaction classifier calls. Each call is a
   * mini-model request billed to the user's provider credentials.
   */
  dailyFeedbackClassifierBudgetPerUser: 200,
  generationLockTtlSeconds: 5,
  /**
   * Most distinct topics one user's nightly review may process for one local review date, across
   * all of that user's agents: topics fed into each agent's review context plus topics the
   * nightly expertise ingestion reads. Everyday conversation has no count cap.
   */
  nightlyReviewTopicLimitPerUser: 50,
  receiptTtlSeconds: 3 * 24 * 60 * 60,
  runtimeGuardTtlSeconds: 3600,
  runtimeWaypointTtlSeconds: 3600,
  /** Max accepted self-feedback intent declarations per operation (or topic) scope. */
  selfFeedbackIntentDeclarationLimitPerScope: 3,
  signalDedupeTtlSeconds: 300,
  signalWindowTtlSeconds: 3600,
} as const;

/** Server-owned runtime backend identifiers. */
export const AGENT_SIGNAL_RUNTIME_BACKENDS = {
  memory: 'memory',
} as const;
