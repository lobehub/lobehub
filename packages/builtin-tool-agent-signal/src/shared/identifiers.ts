/**
 * Builtin tool identifiers for the self-iteration background agents.
 *
 * These match the `plugins: [...]` declared by the matching builtin agents
 * (`@lobechat/builtin-agents`): nightly-review → review, self-reflection →
 * reflection, self-feedback-intent → feedback-intent, skill-management →
 * skill-management.
 *
 * Identifiers are stored in message history — treat them as permanent.
 */
export const AGENT_SIGNAL_REVIEW_IDENTIFIER = 'agent-signal-review';
export const AGENT_SIGNAL_REFLECTION_IDENTIFIER = 'agent-signal-reflection';
export const AGENT_SIGNAL_FEEDBACK_INTENT_IDENTIFIER = 'agent-signal-feedback-intent';
export const AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER = 'agent-signal-skill-management';
