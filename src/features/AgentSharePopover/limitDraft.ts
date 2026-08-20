import type { AgentShareLimitField, AgentShareLimitPatch } from './useDebouncedLimitPatch';

export type AgentShareLimitDraft = Partial<Record<AgentShareLimitField, number | null>>;

/** Clear only values acknowledged by this commit, preserving edits typed while it was in flight. */
export const clearCommittedLimitDraft = (
  draft: AgentShareLimitDraft,
  patch: AgentShareLimitPatch,
): AgentShareLimitDraft => {
  const next = { ...draft };
  for (const [field, value] of Object.entries(patch)) {
    const limitField = field as AgentShareLimitField;
    if (next[limitField] === value) delete next[limitField];
  }
  return next;
};
