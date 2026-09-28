export const HETEROGENEOUS_AGENT_INTERVENTION_KINDS = ['permission', 'plan', 'question'] as const;

export type HeterogeneousAgentInterventionKind =
  (typeof HETEROGENEOUS_AGENT_INTERVENTION_KINDS)[number];

export const HETEROGENEOUS_AGENT_INTERVENTION_PROVIDERS = [
  'claude-code',
  'cursor',
  'devin',
  'droid',
  'qoder',
] as const;

export type HeterogeneousAgentInterventionProvider =
  (typeof HETEROGENEOUS_AGENT_INTERVENTION_PROVIDERS)[number];

export const HETEROGENEOUS_AGENT_INTERVENTION_STATUSES = [
  'pending',
  'resolving',
  'resolved',
  'cancelled',
  'timed_out',
  'session_ended',
] as const;

export type HeterogeneousAgentInterventionStatus =
  (typeof HETEROGENEOUS_AGENT_INTERVENTION_STATUSES)[number];

/** A producer-provided choice after sensitive arguments have been removed. */
export interface HeterogeneousAgentInterventionOption {
  description?: string;
  /** Required for permission/plan; question providers may only supply labels. */
  id?: string;
  label: string;
  recommended?: boolean;
}

/** One structured-input question preserved for cold-start Review rendering. */
export interface HeterogeneousAgentInterventionQuestion {
  header?: string;
  id?: string;
  multiSelect?: boolean;
  options: HeterogeneousAgentInterventionOption[];
  question: string;
}

/**
 * Durable, renderable request contract. This deliberately has no open-ended
 * metadata/arguments bag: persistence callers must copy only fields that are
 * safe and necessary for Review while retaining exact provider option ids.
 */
export interface HeterogeneousAgentInterventionSanitizedRequest {
  apiName: string;
  identifier?: string;
  options?: HeterogeneousAgentInterventionOption[];
  prompt?: string;
  questions?: HeterogeneousAgentInterventionQuestion[];
}

/** Short copy safe to place on notification and Live Activity surfaces. */
export interface HeterogeneousAgentInterventionReviewContext {
  agentLabel?: string;
  resourceLabel?: string;
  summary?: string;
  title: string;
}

/** User response routed back to the exact blocked producer callback. */
export type HeterogeneousAgentInterventionResult = Record<string, string | string[]>;

export interface HeterogeneousAgentInterventionResolutionPayload {
  cancelled?: boolean;
  cancelReason?: 'session_ended' | 'timeout' | 'user_cancelled';
  /** Question text (or a reserved form key) to freeform text or exact option values. */
  result?: HeterogeneousAgentInterventionResult;
}

/**
 * Producer-stamped wall-clock deadline (unix ms) carried on the tool row's
 * `pluginState.heterogeneousIntervention`, and mirrored onto the folded tool
 * entry as `result.state`. Both shapes are read the same way.
 */
export const readHeterogeneousInterventionDeadline = (state: unknown): number | undefined => {
  const deadline = (
    state as { heterogeneousIntervention?: { deadline?: unknown } } | null | undefined
  )?.heterogeneousIntervention?.deadline;
  return typeof deadline === 'number' ? deadline : undefined;
};

/**
 * True once the producer has stopped waiting for this answer.
 *
 * The deadline is the producer's own: its ask-user bridge deletes the pending
 * entry at exactly that instant and its long-poll stops listening with it, so
 * past the deadline "nobody is waiting for this answer" is a fact, not a guess.
 * A question in that state must never be offered as answerable — submitting
 * into it cannot be received, and asking the user to act on it is asking for
 * work that will be thrown away.
 *
 * Unknown deadline (local desktop runs, rows written before the producer
 * stamped one) returns false: without the producer's clock we cannot claim it
 * gave up.
 */
export const isHeterogeneousInterventionExpired = (
  state: unknown,
  now: number = Date.now(),
): boolean => {
  const deadline = readHeterogeneousInterventionDeadline(state);
  return deadline !== undefined && now >= deadline;
};
