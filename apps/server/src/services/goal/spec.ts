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
  /**
   * The claim is broken, not merely "not a batch": the planner said one mould
   * but could not lay it out (no recipe, a roster missing units or too large,
   * probes that are not roster units). One pass was not enough, so the main
   * Agent plans it instead when the Goal has one.
   */
  malformed: boolean;
  /** Why it failed; empty when `batch` is true. Kept for the trace and tests. */
  reasons: string[];
}

const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a declared axis value is represented in the probe text.
 *
 * A Latin/alphanumeric value must appear on a word boundary, so a value like
 * `no` is not counted as covered by the word `node` or `not` — otherwise an
 * all-`yes` probe set would silently satisfy the `no` variant and the gate would
 * release the mass rollout without ever testing it. Values in scripts without
 * word boundaries (e.g. CJK) keep substring matching, where boundaries have no
 * meaning.
 */
export const containsAxisValue = (haystack: string, value: string): boolean => {
  const needle = value.trim().toLowerCase();
  if (!needle) return false;
  const text = haystack.toLowerCase();
  if (!/^[\p{Script=Latin}\p{N} _-]+$/u.test(needle)) return text.includes(needle);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, 'u').test(
    text,
  );
};

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
  const haystack = briefs.map((brief) => `${brief.title}\n${brief.instruction}`).join('\n');
  const uncovered: Array<{ axis: string; value: string }> = [];
  for (const axis of axes) {
    for (const value of axis.values) {
      if (!containsAxisValue(haystack, value)) uncovered.push({ axis: axis.axis, value });
    }
  }
  return uncovered;
};

/**
 * Validate the planner's batch claim before decomposition acts on it.
 *
 * The checks are structural only: the planner marked it repeatable, named the
 * one reusable transformation, counted at least the threshold of homogeneous
 * units, listed every one of them in the roster, and listed more than one probe.
 * Whether the recipe really holds is not judged from the wording here — the
 * probes prove it by running, and the release gate holds the rest of the roster
 * until they do. A claim that is not a batch keeps the ordinary decomposition; a
 * broken one is `malformed`, which the coordinator hands to the main Agent.
 *
 * `maxUnits` is the batch roster's ceiling (the caller's config bound). A claim
 * above it is refused here rather than batched, so the roster a batch carries is
 * always the whole one: the coordinator waves it out unit by unit, and a cap
 * applied at creation would silently leave the tail undelivered.
 */
export const evaluateHomogeneity = (
  spec: BatchSpecDraft,
  briefs: ProbeBrief[],
  options: { maxUnits?: number; minUnits?: number } = {},
): HomogeneityVerdict => {
  const minUnits = options.minUnits ?? ROLLOUT_MIN_HOMOGENEOUS_UNITS;
  // "Not a batch": the ordinary decomposition is the right plan.
  const notBatch: string[] = [];
  // A broken claim: one pass could not lay the mould out.
  const broken: string[] = [];

  if (!spec.repeatable) notBatch.push('planner did not mark the goal repeatable');
  if (!Number.isFinite(spec.unitCount) || spec.unitCount < minUnits)
    notBatch.push(`unitCount ${spec.unitCount} is below the threshold ${minUnits}`);
  if (!spec.recipeOutline?.trim()) broken.push('no reusable recipe outline');
  // The roster is what the waves deliver: a claim the roster cannot account for
  // would exhaust it early and silently drop every unit it left out. Only the
  // declared units count, and every probe must be one of them — a probe the
  // roster does not name would stand in for a unit nobody listed, and the unit
  // it displaced would never be delivered.
  const probeTitles = briefs.map((brief) => brief.title.trim()).filter(Boolean);
  const units = (spec.units ?? []).map((unit) => unit.trim()).filter(Boolean);
  const probed = unitsNamedByProbes(probeTitles, units);
  const stray = probeTitles.filter(
    (title) => !units.includes(title) && !units.some((unit) => probed.get(unit) === title),
  );
  if (stray.length)
    broken.push(`probe ${stray.map((title) => `"${title}"`).join(', ')} is not a roster unit`);
  const roster = new Set(units);
  const lostUnits = Number.isFinite(spec.unitCount) && roster.size < spec.unitCount;
  if (lostUnits) broken.push(`roster lists ${roster.size} of the ${spec.unitCount} claimed units`);
  if (options.maxUnits !== undefined && roster.size > options.maxUnits)
    broken.push(`roster lists ${roster.size} units, above the batch cap of ${options.maxUnits}`);
  if (briefs.length < 2) broken.push('fewer than two probe units');

  // A claim that is not worth a batch (not repeatable, too few units) plans
  // ordinarily, where probes and a recipe do not matter — but a roster missing
  // units would drop them there too, so that stays broken either way.
  const reasons = [...notBatch, ...broken];
  return {
    batch: reasons.length === 0,
    malformed: broken.length > 0 && (notBatch.length === 0 || lostUnits),
    reasons,
  };
};

/**
 * The roster units a model's probes stand for. Its probe titles wrap the unit
 * ("迁移 device store（探针）" for unit `device`), so a unit is the probe when
 * its title names it — as a whole word, or a substring in scripts without word
 * boundaries. Each probe stands for one unit only, the longest name its title
 * holds, so the probe `agent runtime` leaves the separate unit `agent` queued:
 * a probe covering two units costs a rerun, never a unit that is dropped.
 */
/** Scripts written without spaces between words, where a name has no boundary. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Whether a probe title names a unit. A unit in an unspaced script is matched
 * as a substring; any other — a word, a path like `src/a.ts`, a dotted module —
 * only where neither side continues it, so `src/a.tsx` and `src/a.ts.bak` do not
 * name `src/a.ts`, and `agentic` does not name `agent`.
 */
const titleNamesUnit = (title: string, unit: string): boolean => {
  const name = unit.trim().toLowerCase();
  if (!name) return false;
  const text = title.toLowerCase();
  if (UNSPACED_SCRIPT.test(name)) return text.includes(name);
  // A name continues through a separator into more name — `src/a.ts.bak`,
  // `lib/src/a.ts`, `@scope/pkg.v2` are other units — while a full stop or a
  // space after it does not.
  const word = '[\\p{L}\\p{N}_]';
  return new RegExp(
    `(?<!${word})(?<!${word}[./-])${escapeRegExp(name)}(?!${word})(?![./-]${word})`,
    'u',
  ).test(text);
};

export const unitsNamedByProbes = (probeTitles: string[], units: string[]): Map<string, string> => {
  // unit → the probe title that stands for it
  const named = new Map<string, string>();
  const candidates = [...new Set(units)].filter((unit) => !probeTitles.includes(unit));
  for (const probe of probeTitles) {
    const unit = candidates
      .filter((candidate) => !named.has(candidate) && titleNamesUnit(probe, candidate))
      .sort((a, b) => b.length - a.length)[0];
    if (unit) named.set(unit, probe);
  }
  return named;
};
