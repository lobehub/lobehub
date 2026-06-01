import type { ToolResultKind } from './ExecutionRuntime';

/**
 * Resource tools shared by every self-iteration mode: live-DB skill reads + safe
 * memory/skill writes.
 *
 * Note: there is intentionally no `getEvidenceDigest` tool — the evidence corpus
 * is collected once at dispatch and embedded in the agent's prompt
 * (`<nightly_review_context_json>` etc.), so the agent already has it in context.
 * A tool re-serving that same blob would be redundant.
 */
export const AGENT_SIGNAL_RESOURCE_API_NAMES = [
  'listManagedSkills',
  'getManagedSkill',
  'writeMemory',
  'createSkillIfAbsent',
  'replaceSkillContentCAS',
] as const;

/** Review-only tools: proposal lifecycle + the non-actionable idea recorder. */
export const AGENT_SIGNAL_REVIEW_API_NAMES = [
  'listSelfReviewProposals',
  'readSelfReviewProposal',
  'createSelfReviewProposal',
  'refreshSelfReviewProposal',
  'supersedeSelfReviewProposal',
  'closeSelfReviewProposal',
  'recordSelfReviewIdea',
] as const;

/** Reflection / feedback-intent tools: receipt-backed idea + intent recorders. */
export const AGENT_SIGNAL_REFLECTION_API_NAMES = [
  'recordReflectionIdea',
  'recordSelfFeedbackIntent',
] as const;

export const AGENT_SIGNAL_REVIEW_TOOL_API_NAMES = [
  ...AGENT_SIGNAL_RESOURCE_API_NAMES,
  ...AGENT_SIGNAL_REVIEW_API_NAMES,
] as const;

export const AGENT_SIGNAL_REFLECTION_TOOL_API_NAMES = [
  ...AGENT_SIGNAL_RESOURCE_API_NAMES,
  ...AGENT_SIGNAL_REFLECTION_API_NAMES,
] as const;

export type AgentSignalToolApiName =
  | (typeof AGENT_SIGNAL_REVIEW_TOOL_API_NAMES)[number]
  | (typeof AGENT_SIGNAL_REFLECTION_TOOL_API_NAMES)[number];

/**
 * Result discriminator per tool. The shared ExecutionRuntime
 * stamps this onto every tool result so `extractFromFinalState` can partition
 * read / artifact / mutation outcomes from a persisted snapshot.
 */
export const AGENT_SIGNAL_TOOL_RESULT_KIND: Record<AgentSignalToolApiName, ToolResultKind> = {
  closeSelfReviewProposal: 'mutation',
  createSelfReviewProposal: 'mutation',
  createSkillIfAbsent: 'mutation',
  getManagedSkill: 'read',
  listManagedSkills: 'read',
  listSelfReviewProposals: 'read',
  readSelfReviewProposal: 'read',
  recordReflectionIdea: 'artifact',
  recordSelfFeedbackIntent: 'artifact',
  recordSelfReviewIdea: 'artifact',
  refreshSelfReviewProposal: 'mutation',
  replaceSkillContentCAS: 'mutation',
  supersedeSelfReviewProposal: 'mutation',
  writeMemory: 'mutation',
};
