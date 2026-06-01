import type { ToolResultKind } from './ExecutionRuntime';

/**
 * Resource tools shared by every self-iteration mode (read evidence + apply safe
 * memory/skill writes).
 */
export const AGENT_SIGNAL_RESOURCE_API_NAMES = [
  'listManagedSkills',
  'getManagedSkill',
  'getEvidenceDigest',
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
 * Result discriminator per tool (LOBE-9434 #5). The shared ExecutionRuntime
 * stamps this onto every tool result so `extractFromFinalState` can partition
 * read / artifact / mutation outcomes from a persisted snapshot.
 */
export const AGENT_SIGNAL_TOOL_RESULT_KIND: Record<AgentSignalToolApiName, ToolResultKind> = {
  closeSelfReviewProposal: 'mutation',
  createSelfReviewProposal: 'mutation',
  createSkillIfAbsent: 'mutation',
  getEvidenceDigest: 'read',
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
