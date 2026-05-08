import { z } from 'zod';

import type { AgentSignalPolicyStateStore } from '../../store/types';
import type {
  AgentSignalSkillActionIntent,
  AgentSignalSkillIntentExplicitness,
  AgentSignalSkillIntentRoute,
} from '../types';

const POLICY_ID = 'analyze-intent:skill-candidates';

const DeferredSkillCandidateSchema = z.object({
  actionIntent: z.enum(['create', 'refine', 'consolidate', 'maintain', 'noop']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  createdAt: z.number(),
  explicitness: z.enum([
    'explicit_action',
    'implicit_strong_learning',
    'weak_positive',
    'non_skill_preference',
  ]),
  feedbackMessageId: z.string(),
  reason: z.string().optional(),
  route: z.enum(['direct_decision', 'accumulate', 'non_skill']),
  scopeKey: z.string(),
  sourceId: z.string(),
});

/**
 * Deferred skill candidate stored between user-message and completion analysis stages.
 */
export interface DeferredSkillCandidate {
  /** Optional skill-management action hint selected before final-turn evidence is hydrated. */
  actionIntent?: AgentSignalSkillActionIntent;
  /** Optional confidence of the user-stage skill-intent classifier, from 0 to 1. */
  confidence?: number;
  /** Time the candidate was written, in epoch milliseconds. */
  createdAt: number;
  /** Whether the user-stage feedback looked explicit, strong implicit, weak, or non-skill. */
  explicitness: AgentSignalSkillIntentExplicitness;
  /** User feedback message id that produced this candidate. */
  feedbackMessageId: string;
  /** Optional private-safe reason suitable for traces and eval assertions. */
  reason?: string;
  /** Runtime route selected before completion-stage evidence is available. */
  route: AgentSignalSkillIntentRoute;
  /** Runtime scope key where the candidate is visible. */
  scopeKey: string;
  /** Source id that produced this candidate. */
  sourceId: string;
}

const candidateField = (sourceId: string) => `skill-candidate:${sourceId}`;

/**
 * Writes one deferred skill candidate to policy state.
 *
 * Use when:
 * - User-message analysis finds skill intent before assistant completion
 * - Skill mutation should wait for final-turn evidence
 *
 * Expects:
 * - `scopeKey` matches the later completion source scope
 *
 * Returns:
 * - Resolves after the candidate field is stored
 */
export const writeDeferredSkillCandidate = async (
  store: AgentSignalPolicyStateStore,
  input: {
    candidate: DeferredSkillCandidate;
    scopeKey: string;
    ttlSeconds: number;
  },
) => {
  await store.writePolicyState(
    POLICY_ID,
    input.scopeKey,
    {
      [candidateField(input.candidate.sourceId)]: JSON.stringify(input.candidate),
    },
    input.ttlSeconds,
  );
};

/**
 * Reads one deferred skill candidate from policy state.
 *
 * Use when:
 * - Completion-stage skill management needs earlier user-stage intent
 *
 * Expects:
 * - Candidate JSON may be absent, malformed, or structurally invalid
 *
 * Returns:
 * - Parsed candidate, or `undefined` when unavailable
 */
export const readDeferredSkillCandidate = async (
  store: AgentSignalPolicyStateStore,
  input: {
    scopeKey: string;
    sourceId: string;
  },
): Promise<DeferredSkillCandidate | undefined> => {
  const state = await store.readPolicyState(POLICY_ID, input.scopeKey);
  const raw = state?.[candidateField(input.sourceId)];
  if (!raw) return undefined;

  try {
    const candidate = DeferredSkillCandidateSchema.parse(JSON.parse(raw));
    if (candidate.scopeKey !== input.scopeKey || candidate.sourceId !== input.sourceId) {
      return undefined;
    }

    return candidate;
  } catch {
    return undefined;
  }
};
