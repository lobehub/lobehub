import { ROLLOUT_MIN_HOMOGENEOUS_UNITS } from '@lobechat/const/goal';
import type { GoalRolloutVariantAxis } from '@lobechat/types';

/**
 * The planner's batch claim, already parsed.
 *
 * This is the **S** of STAMP: the specification that decides whether a goal is
 * one repeated mould. A claim alone never creates a batch — the coordinator
 * validates it here first, so a planner that over-claims still decomposes one
 * unit per task as it always did.
 */
export interface BatchSpecDraft {
  recipeOutline?: string;
  repeatable: boolean;
  /** Honest count of the homogeneous units in the whole goal. */
  unitCount: number;
  /** Roster of every homogeneous unit; probes come first, in delivery order. */
  units?: string[];
  variants?: GoalRolloutVariantAxis[];
}

/** A single probe brief, only the fields homogeneity is judged on. */
export interface ProbeBrief {
  instruction: string;
  title: string;
}

export interface HomogeneityVerdict {
  batch: boolean;
  /** Why it failed; empty when `batch` is true. Kept for the trace and tests. */
  reasons: string[];
}

/**
 * R2's executable core, restated as code: "replace the concrete file / module /
 * symbol names with placeholders — are the transformation steps still the same?"
 *
 * The masking is deliberately crude and deterministic. It is not trying to
 * understand the prose; it removes the parts that make two applications of one
 * recipe *look* different (paths, identifiers, numbers, and inline code), so
 * what is left can be compared. A false negative here only costs the batch
 * ceremony — the goal decomposes normally — which is the safe direction.
 */
export const maskConcreteNames = (text: string): string =>
  text
    .replaceAll(/`[^`]*`/g, ' <code> ')
    // POSIX / URL-ish paths and dotted module specifiers.
    .replaceAll(/\b[\w.@-]*(?:\/[\w.@-]+)+\b/g, ' <path> ')
    // camelCase / PascalCase / SCREAMING_CASE symbols. The character classes
    // after each capital are lowercase/digit/underscore only, so the repeated
    // group cannot match the same text two ways (no super-linear backtracking).
    .replaceAll(/\b[a-z][a-z0-9_$]*(?:[A-Z][a-z0-9_$]*)+\b/g, ' <ident> ')
    .replaceAll(/\b(?:[A-Z][a-z0-9_$]*){2,}\b/g, ' <ident> ')
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}\b/g, ' <ident> ')
    // Bare numbers (counts, indices, thresholds).
    .replaceAll(/\b\d+(?:\.\d+)?\b/g, ' <n> ')
    .toLowerCase()
    .replaceAll(/\s+/g, ' ')
    .trim();

const tokensOf = (text: string): Set<string> =>
  new Set(
    maskConcreteNames(text)
      .split(/[^\p{L}\p{N}<>]+/u)
      .filter((token) => token.length > 1),
  );

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
};

/** Lowest pairwise Jaccard similarity across every pair of probe shapes. */
export const minPairwiseSimilarity = (briefs: ProbeBrief[]): number => {
  if (briefs.length < 2) return 1;
  const shapes = briefs.map((brief) => tokensOf(`${brief.title}\n${brief.instruction}`));
  let min = 1;
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      min = Math.min(min, jaccard(shapes[i], shapes[j]));
    }
  }
  return min;
};

/**
 * Below this the probe briefs are describing different work, not one recipe
 * applied to different units.
 */
export const HOMOGENEITY_MIN_SIMILARITY = 0.5;

/**
 * R4's coverage check: axes the planner declared, and the values on them that
 * no probe touches. A declared value with zero coverage is the half the probe
 * missed, and the gate must not read green until it is seen — so this is a
 * gate blocker, not a reason to refuse creating the batch.
 */
export const uncoveredAxisValues = (
  axes: GoalRolloutVariantAxis[] | undefined,
  briefs: ProbeBrief[],
): Array<{ axis: string; value: string }> => {
  if (!axes?.length) return [];
  const haystack = briefs
    .map((brief) => `${brief.title}\n${brief.instruction}`)
    .join('\n')
    .toLowerCase();
  const uncovered: Array<{ axis: string; value: string }> = [];
  for (const axis of axes) {
    for (const value of axis.values) {
      const needle = value.trim().toLowerCase();
      if (needle && !haystack.includes(needle)) uncovered.push({ axis: axis.axis, value });
    }
  }
  return uncovered;
};

/**
 * Validate the planner's batch claim before decomposition acts on it.
 *
 * Every condition must hold: the planner marked it repeatable, named the one
 * reusable transformation, counted at least the threshold of homogeneous units,
 * listed every one of them in the roster, listed more than one probe, and the
 * probes really read as one mould after masking. Any failure keeps the ordinary
 * one-unit-per-task decomposition and records why.
 */
export const evaluateHomogeneity = (
  spec: BatchSpecDraft,
  briefs: ProbeBrief[],
  options: { minUnits?: number } = {},
): HomogeneityVerdict => {
  const minUnits = options.minUnits ?? ROLLOUT_MIN_HOMOGENEOUS_UNITS;
  const reasons: string[] = [];

  if (!spec.repeatable) reasons.push('planner did not mark the goal repeatable');
  if (!spec.recipeOutline?.trim()) reasons.push('no reusable recipe outline');
  if (!Number.isFinite(spec.unitCount) || spec.unitCount < minUnits)
    reasons.push(`unitCount ${spec.unitCount} is below the threshold ${minUnits}`);
  // The roster is what the waves deliver: a claim the roster cannot account for
  // would exhaust it early and silently drop every unit it left out.
  const roster = new Set(
    [...briefs.map((brief) => brief.title), ...(spec.units ?? [])]
      .map((title) => title.trim())
      .filter(Boolean),
  );
  if (Number.isFinite(spec.unitCount) && roster.size < spec.unitCount)
    reasons.push(`roster lists ${roster.size} of the ${spec.unitCount} claimed units`);
  if (briefs.length < 2) reasons.push('fewer than two probe units');

  if (briefs.length >= 2 && minPairwiseSimilarity(briefs) < HOMOGENEITY_MIN_SIMILARITY)
    reasons.push('probe briefs do not describe one reusable transformation');

  return { batch: reasons.length === 0, reasons };
};
