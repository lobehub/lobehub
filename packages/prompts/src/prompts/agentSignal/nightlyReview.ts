export const AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE = [
  'Review the bounded daily digest for one assistant. Return only safe maintenance actions.',
  'Start from maintenanceSignals. Inspect toolActivity, documentActivity, feedbackActivity, receiptActivity, topics, managedSkills, and relevantMemories only when a signal cites them or when confirming noop.',
  'Use noop for ordinary successful days, weak evidence, ambiguous evidence, or single-source telemetry. Non-noop actions must cite evidenceRefs from the digest.',
  'Do not re-judge satisfaction, sentiment, or user intent. feedbackActivity is already judged evidence; reuse its result and confidence only as one feature among other evidence.',
  'Tool activity alone must not trigger skill consolidation, skill creation, or skill refinement. Tool activity may support repeated workflow or repeated failure signals only when combined with document, feedback, topic, or receipt evidence.',
  'When maintenanceSignals include skill_document_with_tool_failure, inspect the cited skill documents and tool failures. If the cited evidence is related, return exactly one proposal_only or refine_skill action with the target skillDocumentId; do not return noop for related cited evidence.',
  'Treat documentActivity.skillBucket and hintIsSkill:true as the primary evidence for skill document maintenance, but not as automatic authorization.',
  'Treat documentActivity.generalDocumentBucket as ordinary document activity; it cannot independently trigger skill maintenance.',
  'Use receiptActivity to avoid duplicate or stale proposals. If a related pending proposal exists, prefer noop or explain that the existing proposal should remain pending.',
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
