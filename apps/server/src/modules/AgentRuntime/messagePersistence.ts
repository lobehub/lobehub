/**
 * True when `messages` contains an entry with no DB id — a non-persisted
 * (ephemeral / suppressed) message that cannot be reconstructed from a query.
 *
 * The group-member supervisor instruction is the canonical case: it's injected
 * via `suppressUserMessage` + `ephemeralUserMessage`, drives the member's turn,
 * but is deliberately never written as a `role: 'user'` row (so it has a falsy
 * `id`). Ops carrying such a message keep their full working set in Redis
 * instead of being stripped + rehydrated from the DB, which would silently drop
 * the prompt — see `AgentStateManager.serializeStateForPersist` and
 * `AgentRuntimeService.rehydrateStateMessagesFromDB`.
 */
export const hasNonPersistedMessage = (messages: unknown): boolean =>
  Array.isArray(messages) &&
  messages.some((m) => m && typeof m === 'object' && (m as any).role && !(m as any).id);

/**
 * True when the next step's entry read (`queryStepEntryMessages`) will replace
 * `state.messages` with the conversation re-read from the DB: the run is scoped
 * to a topic and its working set holds no row the DB cannot give back.
 *
 * The runtime transport reports this as `rehydratesOnNextStep`, letting tool
 * executors patch their own rows into the state instead of re-reading the whole
 * topic after every tool call. Keep both call sites on this one predicate.
 */
export const willHydrateStepEntryMessages = (state: {
  messages?: unknown;
  origin?: { agentId?: string | null; topicId?: string | null } | null;
}): boolean =>
  !!state.origin?.agentId && !!state.origin?.topicId && !hasNonPersistedMessage(state.messages);
