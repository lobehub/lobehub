export const AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE = [
  'Review the bounded daily digest for one assistant. Return only safe maintenance actions.',
  'Use noop for ordinary successful days. Non-noop actions must cite evidenceRefs from the digest.',
  'Attach policyHints for every non-noop action: evidenceStrength, userExplicitness, sensitivity, persistence, and mutationScope when skill-related.',
  'Auto-safe memory candidates must be explicit, stable, normal-sensitivity preferences or durable facts; inferred, temporal, sensitive, third-party, or ambiguous memory candidates should be proposal_only or noop.',
  'Skill creation/refinement should be proposal_only unless the evidence shows explicit maintenance intent and a small targeted change. Consolidation should stay proposal_only.',
].join(' ');

/**
 * Builds model messages for Agent Signal nightly maintenance review.
 *
 * Use when:
 * - A server reviewer asks the model to convert a bounded digest into maintenance drafts
 * - Tests need the stable prompt contract without importing server runtime code
 *
 * Expects:
 * - `context` is already private-safe and bounded by the caller
 *
 * Returns:
 * - A system/user message pair ready for structured object generation
 */
export const createAgentSignalNightlyReviewMessages = (context: unknown) => [
  {
    content: AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE,
    role: 'system' as const,
  },
  {
    content: JSON.stringify(context),
    role: 'user' as const,
  },
];
