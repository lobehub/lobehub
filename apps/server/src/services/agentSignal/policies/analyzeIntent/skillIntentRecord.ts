import { z } from 'zod';

import type { AgentSignalPolicyStateStore } from '../../store/types';
import type {
  AgentSignalFeedbackDomainConflictPolicy,
  AgentSignalFeedbackEvidence,
  AgentSignalFeedbackSourceHints,
  AgentSignalSkillActionIntent,
  AgentSignalSkillIntentExplicitness,
  AgentSignalSkillIntentRoute,
} from '../types';

const POLICY_ID = 'analyze-intent:skill-intent-records';

/**
 * Synthesis payload parked alongside a detect-stage skill candidate so the
 * deferred completion-stage handler can dispatch the skill-management run from
 * the original user request without re-running domain classification.
 *
 * Trajectory evidence (tool sequence + final product) is assembled fresh at
 * completion; this carries only the inbound-stage facts the completion handler
 * cannot otherwise recover.
 */
const PendingSkillSynthesisSchema = z.object({
  agentId: z.string().optional(),
  conflictPolicy: z
    .object({
      // Mirror AgentSignalFeedbackDomainTarget so the parsed record stays
      // assignable to RecordedSkillIntent.pendingSynthesis (a bare z.string()
      // widens to string[] and breaks the conflictPolicy type).
      forbiddenWith: z.array(z.enum(['memory', 'none', 'prompt', 'skill'])).optional(),
      mode: z.enum(['exclusive', 'fanout']),
      priority: z.number(),
    })
    .optional(),
  evidence: z.array(z.object({ cue: z.string(), excerpt: z.string() })).optional(),
  message: z.string(),
  sourceHints: z.record(z.unknown()).optional(),
  threadId: z.string().optional(),
  topicId: z.string().optional(),
});

const RecordedSkillIntentSchema = z.object({
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
  pendingSynthesis: PendingSkillSynthesisSchema.optional(),
  reason: z.string().optional(),
  route: z.enum(['direct_decision', 'accumulate', 'non_skill']),
  scopeKey: z.string(),
  sourceId: z.string(),
});

/**
 * Synthesis payload parked alongside a detect-stage skill candidate.
 */
export interface PendingSkillSynthesis {
  /** Reviewed user agent the skill receipt should attribute to. */
  agentId?: string;
  /** Inbound-stage conflict policy carried through to the deferred action. */
  conflictPolicy?: AgentSignalFeedbackDomainConflictPolicy;
  /** Inbound-stage evidence, supplemented by trajectory evidence at completion. */
  evidence?: AgentSignalFeedbackEvidence[];
  /** Original user request text that the deferred skill synthesis acts on. */
  message: string;
  /** Structured source hints attached to the inbound feedback source. */
  sourceHints?: AgentSignalFeedbackSourceHints;
  /** Thread the turn ran under, when scoped to a thread. */
  threadId?: string;
  /** Topic the turn ran under. */
  topicId?: string;
}

/**
 * Recorded skill intent stored between user-message and completion analysis stages.
 */
export interface RecordedSkillIntent {
  /** Optional skill-management action hint selected before final-turn evidence is hydrated. */
  actionIntent?: AgentSignalSkillActionIntent;
  /** Optional confidence of the user-stage skill-intent classifier, from 0 to 1. */
  confidence?: number;
  /** Time the record was written, in epoch milliseconds. */
  createdAt: number;
  /** Whether the user-stage feedback looked explicit, strong implicit, weak, or non-skill. */
  explicitness: AgentSignalSkillIntentExplicitness;
  /** User feedback message id that produced this record. */
  feedbackMessageId: string;
  /**
   * Synthesis payload for the deferred completion-stage skill run. Present when
   * a server execAgent inbound turn parked a candidate to synthesize after
   * `agent.execution.completed` (LOBE-10802); absent for the client-runtime
   * lane, which re-derives the source at `client.runtime.complete`.
   */
  pendingSynthesis?: PendingSkillSynthesis;
  /** Optional private-safe reason suitable for traces and eval assertions. */
  reason?: string;
  /** Runtime route selected before completion-stage evidence is available. */
  route: AgentSignalSkillIntentRoute;
  /** Runtime scope key where the record is visible. */
  scopeKey: string;
  /** Source id that produced this record. */
  sourceId: string;
}

const recordField = (sourceId: string) => `skill-intent-record:${sourceId}`;

/**
 * Writes one recorded skill intent to policy state.
 *
 * Use when:
 * - User-message analysis finds skill intent before assistant completion
 * - Skill mutation should wait for final-turn evidence
 *
 * Expects:
 * - `scopeKey` matches the later completion source scope
 *
 * Returns:
 * - Resolves after the record field is stored
 */
export const recordSkillIntent = async (
  store: AgentSignalPolicyStateStore,
  input: {
    record: RecordedSkillIntent;
    scopeKey: string;
    ttlSeconds: number;
  },
) => {
  await store.writePolicyState(
    POLICY_ID,
    input.scopeKey,
    {
      [recordField(input.record.sourceId)]: JSON.stringify(input.record),
    },
    input.ttlSeconds,
  );
};

/**
 * Reads one recorded skill intent from policy state.
 *
 * Use when:
 * - Completion-stage skill management needs earlier user-stage intent
 *
 * Expects:
 * - Record JSON may be absent, malformed, or structurally invalid
 *
 * Returns:
 * - Parsed record, or `undefined` when unavailable
 */
export const readRecordedSkillIntent = async (
  store: AgentSignalPolicyStateStore,
  input: {
    scopeKey: string;
    sourceId: string;
  },
): Promise<RecordedSkillIntent | undefined> => {
  const state = await store.readPolicyState(POLICY_ID, input.scopeKey);
  const raw = state?.[recordField(input.sourceId)];
  if (!raw) return undefined;

  try {
    const record = RecordedSkillIntentSchema.parse(JSON.parse(raw));
    if (record.scopeKey !== input.scopeKey || record.sourceId !== input.sourceId) {
      return undefined;
    }

    return record;
  } catch {
    return undefined;
  }
};
