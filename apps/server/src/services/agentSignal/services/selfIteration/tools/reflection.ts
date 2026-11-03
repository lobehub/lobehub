import type { Idea, SelfFeedbackIntent } from '../types';
import type { ToolWriteResult } from './shared';

/** Reflection action class considered by the direct-apply policy. */
export type ReflectionActionType =
  | 'consolidate_skill'
  | 'create_skill'
  | 'noop'
  | 'proposal_only'
  | 'refine_skill'
  | 'write_memory';

/** Evidence strength used by reflection direct-apply policy. */
export type ReflectionEvidenceStrength = 'medium' | 'strong' | 'weak';

/** Reflection direct-apply policy result. */
export type ReflectionDisposition = 'direct_apply' | 'record_intent';

/** Candidate inspected by the reflection direct-apply policy. */
export interface ReflectionPolicyCandidate {
  /** Action class inferred from self-feedback. */
  actionType: ReflectionActionType;
  /** True when the payload is approval-gated or structural. */
  approvalRequired?: boolean;
  /** True when a memory is concrete and useful for future turns. */
  concreteFutureUse?: boolean;
  /** Confidence normalized from 0 to 1. */
  confidence: number;
  /** True when the candidate contradicts available context. */
  contradictory?: boolean;
  /** Evidence strength after source handling. */
  evidenceStrength: ReflectionEvidenceStrength;
  /** True when a refine_skill candidate is an in-place patch, not a broad rewrite. */
  inPlacePatch?: boolean;
  /** True when the candidate is only useful for the current turn. */
  localToCurrentTurn?: boolean;
  /** True when the content is sensitive. */
  sensitive?: boolean;
  /** True when a skill mutation is small and bounded. */
  smallMutationScope?: boolean;
  /** True when the content is speculative. */
  speculative?: boolean;
  /** True when the target is readonly. */
  targetReadonly?: boolean;
  /** Existing skill document id for refine_skill. */
  targetSkillDocumentId?: string;
  /** True when usable memory content exists. */
  usableMemoryContent?: boolean;
}

/**
 * Computes whether reflection may direct-apply a candidate or must record an intent.
 *
 * | Action | Direct-apply rule |
 * | --- | --- |
 * | `write_memory` | confidence >= 0.75, evidence medium/strong, normal sensitivity, concrete future-use content |
 * | `refine_skill` | confidence >= 0.9, strong evidence, existing writable skill target, small in-place mutation |
 * | `create_skill` / `consolidate_skill` / broad or approval-gated actions | record intent |
 *
 * Use when:
 * - Same-turn self-feedback needs a deterministic gate before mutating memory or skill resources
 * - Tests need to verify threshold math without running the model runtime
 *
 * Expects:
 * - Confidence has already been normalized to 0..1
 * - Target flags come from trusted source-handler or resource preflight context
 *
 * Returns:
 * - `direct_apply` only for low-risk supported actions
 * - `record_intent` for approval-gated, structural, unsupported, or low-confidence candidates
 */
export const getReflectionDisposition = (
  candidate: ReflectionPolicyCandidate,
): ReflectionDisposition => {
  if (candidate.approvalRequired) return 'record_intent';

  if (candidate.actionType === 'write_memory') {
    const evidenceIsUsable =
      candidate.evidenceStrength === 'medium' || candidate.evidenceStrength === 'strong';
    const unsafeMemory =
      candidate.sensitive ||
      candidate.speculative ||
      candidate.contradictory ||
      candidate.localToCurrentTurn;

    return candidate.confidence >= 0.75 &&
      evidenceIsUsable &&
      candidate.concreteFutureUse === true &&
      candidate.usableMemoryContent === true &&
      !unsafeMemory
      ? 'direct_apply'
      : 'record_intent';
  }

  if (candidate.actionType === 'refine_skill') {
    return candidate.confidence >= 0.9 &&
      candidate.evidenceStrength === 'strong' &&
      candidate.smallMutationScope === true &&
      candidate.inPlacePatch === true &&
      Boolean(candidate.targetSkillDocumentId) &&
      candidate.targetReadonly !== true
      ? 'direct_apply'
      : 'record_intent';
  }

  return 'record_intent';
};

/** Adapter surface for reflection-only receipt writes. */
export interface ReflectionToolsAdapters {
  /** Records a reflection idea into receipt metadata. */
  recordReflectionIdea?: (idea: Idea) => Promise<ToolWriteResult>;
  /** Records a downgraded self-feedback intent into receipt metadata. */
  recordSelfFeedbackIntent?: (intent: SelfFeedbackIntent) => Promise<ToolWriteResult>;
}

/**
 * Reflection-mode tool facade for immediate agent feedback output.
 *
 * Use when:
 * - Same-turn self-feedback needs to preserve ideas and intents in receipts
 * - Reflection must avoid review proposal lifecycle writes
 *
 * Expects:
 * - The caller already decided whether an action direct-applies or downgrades to an intent
 * - Reflection output persists through receipt metadata, not Daily Brief artifacts
 *
 * Returns:
 * - A class surface for receipt-backed reflection ideas and self-feedback intents
 */
export class ReflectionTools {
  constructor(private readonly adapters: ReflectionToolsAdapters = {}) {}

  async recordReflectionIdea(idea: Idea): Promise<ToolWriteResult> {
    if (!this.adapters.recordReflectionIdea) {
      return {
        status: 'skipped_unsupported',
        summary: 'Reflection idea recording is not supported.',
      };
    }

    return this.adapters.recordReflectionIdea(idea);
  }

  async recordSelfFeedbackIntent(intent: SelfFeedbackIntent): Promise<ToolWriteResult> {
    if (!this.adapters.recordSelfFeedbackIntent) {
      return {
        status: 'skipped_unsupported',
        summary: 'Self-iteration intent recording is not supported.',
      };
    }

    return this.adapters.recordSelfFeedbackIntent(intent);
  }
}
