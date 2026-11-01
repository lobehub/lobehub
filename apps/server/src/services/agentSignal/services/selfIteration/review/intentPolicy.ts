import type { SelfFeedbackIntent } from '../types';

/** Evidence strength assigned to a squashed self-feedback intent group. */
export type ReviewEvidenceStrength = 'medium' | 'strong' | 'weak';

/** Review behavior selected for one ranked shared candidate. */
export type ReviewCandidateBehavior = 'idea_or_wait' | 'proposal_priority' | 'weak_evidence';

/** Reflection intent shape accepted by the review policy before normalization. */
export interface ReflectionIntentPolicyInput extends Omit<SelfFeedbackIntent, 'confidence'> {
  /** Optional confidence; missing values default to `0.5`. */
  confidence?: number;
}

/** Group of normalized reflection intents that target the same review decision. */
export interface SelfFeedbackIntentGroup {
  /** Intents in this group. */
  intents: SelfFeedbackIntent[];
  /** Stable grouping key: `intentType + actionType + target signature`. */
  key: string;
}

/** Squashed candidate produced from one intent group. */
export interface SquashedSelfFeedbackIntentGroup {
  /** Aggregate confidence calculated with max(confidence). */
  confidence: number;
  /** Evidence ids after de-duplicating group evidence refs. */
  evidenceRefs: SelfFeedbackIntent['evidenceRefs'];
  /** Evidence strength derived from confidence and repetition. */
  evidenceStrength: ReviewEvidenceStrength;
  /** Representative intent selected by confidence and urgency. */
  intent: SelfFeedbackIntent;
  /** Stable group key. */
  key: string;
  /** Number of intents in the group. */
  repeatCount: number;
}

/** Ranked review candidate with behavior guidance for the review agent prompt. */
export interface RankedSelfFeedbackCandidate extends SquashedSelfFeedbackIntentGroup {
  /** How review should treat this candidate. */
  reviewBehavior: ReviewCandidateBehavior;
}

const urgencyRank = {
  immediate: 0,
  soon: 1,
  later: 2,
} satisfies Record<SelfFeedbackIntent['urgency'], number>;

const clampConfidence = (value: number | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;

  return Math.min(1, Math.max(0, value));
};

const getEvidenceKey = (evidence: SelfFeedbackIntent['evidenceRefs'][number]) =>
  `${evidence.type}:${evidence.id}`;

const hasTargetOrOperation = (intent: SelfFeedbackIntent) =>
  Boolean(
    intent.operation ||
    intent.target?.memoryId ||
    intent.target?.skillDocumentId ||
    intent.target?.skillName ||
    intent.target?.topicIds?.length ||
    intent.target?.taskIds?.length,
  );

/**
 * Normalizes reflection intent payloads before review grouping.
 *
 * | Input | Output |
 * | --- | --- |
 * | missing confidence | `0.5` |
 * | confidence `< 0` | `0` |
 * | confidence `> 1` | `1` |
 *
 * Use when:
 * - Receipt metadata may omit confidence
 * - Review needs stable math before ranking candidates
 *
 * Expects:
 * - Input already represents reflection-mode agent feedback
 *
 * Returns:
 * - A normalized intent with confidence clamped to 0..1
 */
export const normalizeReflectionIntent = (
  intent: ReflectionIntentPolicyInput,
): SelfFeedbackIntent => ({
  ...intent,
  confidence: clampConfidence(intent.confidence),
});

/**
 * Builds a deterministic target signature for grouping reflection intents.
 *
 * | Target data | Signature |
 * | --- | --- |
 * | `skillDocumentId` | `skill:<id>` |
 * | `skillName` | `skill-name:<name>` |
 * | `memoryId` | `memory:<id>` |
 * | topic ids | `topics:<sorted ids>` |
 * | task ids | `tasks:<sorted ids>` |
 * | no target | `target:none` |
 *
 * Use when:
 * - Review needs repeated reflection intents to squash into one candidate
 * - Target order should not affect grouping
 *
 * Expects:
 * - Intent target ids are stable within the review window
 *
 * Returns:
 * - A compact string suitable for a group key
 */
export const getSelfFeedbackIntentTargetSignature = (intent: SelfFeedbackIntent) => {
  if (intent.target?.skillDocumentId) return `skill:${intent.target.skillDocumentId}`;
  if (intent.target?.skillName) return `skill-name:${intent.target.skillName}`;
  if (intent.target?.memoryId) return `memory:${intent.target.memoryId}`;
  if (intent.target?.topicIds?.length) {
    return `topics:${[...intent.target.topicIds].sort().join(',')}`;
  }
  if (intent.target?.taskIds?.length) {
    return `tasks:${[...intent.target.taskIds].sort().join(',')}`;
  }

  return 'target:none';
};

/**
 * Groups normalized reflection intents by type, action, and target.
 *
 * | Rule | Calculation |
 * | --- | --- |
 * | Group key | `intentType + actionType + target signature` |
 * | Missing action type | `unknown` |
 * | Target signature | {@link getSelfFeedbackIntentTargetSignature} |
 *
 * Use when:
 * - Review context needs repeated reflection feedback squashed before prompting
 *
 * Expects:
 * - Callers normalize confidence with {@link normalizeReflectionIntent}
 *
 * Returns:
 * - Groups in first-seen order
 */
export const groupSelfFeedbackIntents = (
  intents: SelfFeedbackIntent[],
): SelfFeedbackIntentGroup[] => {
  const groups = new Map<string, SelfFeedbackIntent[]>();

  for (const intent of intents) {
    const key = `${intent.intentType}:${intent.actionType ?? 'unknown'}:${getSelfFeedbackIntentTargetSignature(intent)}`;
    const group = groups.get(key);

    if (group) {
      group.push(intent);
    } else {
      groups.set(key, [intent]);
    }
  }

  return [...groups.entries()].map(([key, groupIntents]) => ({ intents: groupIntents, key }));
};

const getEvidenceStrength = (confidence: number, repeatCount: number): ReviewEvidenceStrength => {
  if (confidence < 0.5) return 'weak';
  if (confidence >= 0.8 || repeatCount >= 2) return 'strong';

  return 'medium';
};

/**
 * Squashes one intent group into a review candidate.
 *
 * | Rule | Calculation |
 * | --- | --- |
 * | Aggregate confidence | `max(confidence)` |
 * | Repeated evidence | increases evidence strength, not confidence |
 * | Weak threshold | `< 0.5` |
 * | Medium threshold | `>= 0.5` and `< 0.8` |
 * | Strong threshold | `>= 0.8` or repeated matching intents |
 *
 * Use when:
 * - Review needs one candidate per target/action group
 *
 * Expects:
 * - The group contains at least one normalized intent
 *
 * Returns:
 * - Confidence, evidence strength, representative intent, and de-duplicated evidence refs
 */
export const squashSelfFeedbackIntentGroup = (
  group: SelfFeedbackIntentGroup,
): SquashedSelfFeedbackIntentGroup => {
  const sorted = [...group.intents].sort((a, b) => {
    const confidenceDelta = b.confidence - a.confidence;
    if (confidenceDelta !== 0) return confidenceDelta;

    return urgencyRank[a.urgency] - urgencyRank[b.urgency];
  });
  const intent = sorted[0];
  const confidence = Math.max(...group.intents.map((item) => item.confidence));
  const evidenceMap = new Map<string, SelfFeedbackIntent['evidenceRefs'][number]>();

  for (const item of group.intents) {
    for (const evidence of item.evidenceRefs) {
      evidenceMap.set(getEvidenceKey(evidence), evidence);
    }
  }

  return {
    confidence,
    evidenceRefs: [...evidenceMap.values()],
    evidenceStrength: getEvidenceStrength(confidence, group.intents.length),
    intent,
    key: group.key,
    repeatCount: group.intents.length,
  };
};

const getReviewBehavior = (candidate: SquashedSelfFeedbackIntentGroup): ReviewCandidateBehavior => {
  if (candidate.confidence < 0.5) return 'weak_evidence';
  if (
    candidate.confidence >= 0.8 &&
    hasTargetOrOperation(candidate.intent) &&
    candidate.intent.target?.readonly !== true
  ) {
    return 'proposal_priority';
  }

  return 'idea_or_wait';
};

/**
 * Ranks squashed reflection intent groups for nightly self-review.
 *
 * | Rule | Calculation |
 * | --- | --- |
 * | Immediate priority | `immediate` before `soon` before `later` |
 * | Proposal priority | confidence `>= 0.8` with target or operation |
 * | Duplicate groups | squash before ranking |
 *
 * Use when:
 * - Collector exposes reflection intents as review evidence
 * - Prompt builders need deterministic ordering before LLM review
 *
 * Expects:
 * - Groups come from {@link groupSelfFeedbackIntents}
 *
 * Returns:
 * - Ranked candidates with review behavior hints
 */
export const rankSelfFeedbackCandidates = (
  groups: SelfFeedbackIntentGroup[],
): RankedSelfFeedbackCandidate[] =>
  groups
    .map((group) => {
      const candidate = squashSelfFeedbackIntentGroup(group);

      return {
        ...candidate,
        reviewBehavior: getReviewBehavior(candidate),
      };
    })
    .sort((a, b) => {
      const urgencyDelta = urgencyRank[a.intent.urgency] - urgencyRank[b.intent.urgency];
      if (urgencyDelta !== 0) return urgencyDelta;

      return b.confidence - a.confidence;
    });
