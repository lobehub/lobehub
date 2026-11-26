/**
 * The carrier a delivery settles on. `topic`, `channel_thread` and
 * `channel_message` are atomic events; a `task` is a container whose
 * delivery rolls up the atomic deliveries filed under it.
 */
export type AgentDeliverySubjectType = 'channel_message' | 'channel_thread' | 'task' | 'topic';

/** How the requester received the delivery. */
export type AgentDeliveryOutcome = 'abandoned' | 'accepted' | 'partial' | 'rejected' | 'unknown';

/**
 * Where the outcome came from. Kept apart from the outcome itself because an
 * acceptance the requester stated outright and one inferred from silence are
 * not worth the same in any rate built on top of them.
 *   explicit    the requester said so (approved, liked, "looks good")
 *   behavioral  read off what happened next (PR merged, task closed, never revisited)
 *   inferred    judged by the analysis model from the conversation
 */
export type AgentDeliveryOutcomeSource = 'behavioral' | 'explicit' | 'inferred';

/**
 * Who a round of friction is on. A requester who changed their mind mid-way
 * must not count against the Agent.
 */
export type AgentDeliveryFrictionAttribution = 'agent' | 'external' | 'requester';

/** One reason the delivery took more than a straight run. */
export interface AgentDeliveryFriction {
  attribution: AgentDeliveryFrictionAttribution;
  note?: string;
  /** e.g. 'misunderstood' | 'bug' | 'scope_change' | 'environment' | 'permission'. */
  type: string;
}

/** What the delivery did to a Work it touched. */
export type AgentDeliveryWorkRole = 'created' | 'referenced' | 'updated';

/** A delivery with at most this many rounds after the first hand-off counts as smooth. */
export const AGENT_DELIVERY_SMOOTH_MAX_SHOTS = 3;
