/**
 * Builtin tool identifiers for the three self-iteration background agents.
 *
 * These match the `plugins: [...]` declared by the matching builtin agents
 * (`@lobechat/builtin-agents`): nightly-review → review, self-reflection →
 * reflection, self-feedback-intent → feedback-intent.
 *
 * Identifiers are stored in message history — treat them as permanent.
 */
export const AGENT_SIGNAL_REVIEW_IDENTIFIER = 'agent-signal-review';
export const AGENT_SIGNAL_REFLECTION_IDENTIFIER = 'agent-signal-reflection';
export const AGENT_SIGNAL_FEEDBACK_INTENT_IDENTIFIER = 'agent-signal-feedback-intent';
