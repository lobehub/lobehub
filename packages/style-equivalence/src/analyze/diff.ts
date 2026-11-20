import type { ConditionCapture, RunCapture, SectionSnapshot } from '../capture/runner';
import { compareSnapshots, type StyleDifference, type StyleSnapshot } from '../capture/snapshot';

const LOGICAL: Record<string, string> = {
  'border-bottom-left-radius': 'border-end-start-radius',
  'border-bottom-right-radius': 'border-end-end-radius',
  'border-top-left-radius': 'border-start-start-radius',
  'border-top-right-radius': 'border-start-end-radius',
  'bottom': 'inset-block-end',
  'height': 'block-size',
  'left': 'inset-inline-start',
  'margin-bottom': 'margin-block-end',
  'margin-left': 'margin-inline-start',
  'margin-right': 'margin-inline-end',
  'margin-top': 'margin-block-start',
  'max-height': 'max-block-size',
  'max-width': 'max-inline-size',
  'min-height': 'min-block-size',
  'min-width': 'min-inline-size',
  'overflow-x': 'overflow-inline',
  'overflow-y': 'overflow-block',
  'padding-bottom': 'padding-block-end',
  'padding-left': 'padding-inline-start',
  'padding-right': 'padding-inline-end',
  'padding-top': 'padding-block-start',
  'right': 'inset-inline-end',
  'top': 'inset-block-start',
  'width': 'inline-size',
};

const COLOR_MIRRORS = new Set([
  '-webkit-text-fill-color',
  '-webkit-text-stroke-color',
  'caret-color',
  'column-rule-color',
  'outline-color',
  'row-rule-color',
  'text-decoration-color',
  'text-emphasis-color',
]);

const ORIGIN_DERIVED = new Set(['perspective-origin', 'transform-origin']);
const GEOMETRY = new Set(['box', 'scroll']);

export const rootCausesOf = (differences: StyleDifference[]) => {
  const at = (key: string, property: string) =>
    differences.find((item) => item.key === key && item.property === property);
  const hasStyleCause = differences.some(
    (item) => !GEOMETRY.has(item.property) && !ORIGIN_DERIVED.has(item.property),
  );
  return differences.filter((item) => {
    if (GEOMETRY.has(item.property)) return !hasStyleCause;
    if (ORIGIN_DERIVED.has(item.property))
      return !differences.some(
        (other) =>
          other.key === item.key &&
          !GEOMETRY.has(other.property) &&
          !ORIGIN_DERIVED.has(other.property),
      );
    const logical = LOGICAL[item.property];
    if (logical && at(item.key, logical)) return false;
    if (COLOR_MIRRORS.has(item.property)) {
      const color = at(item.key, 'color');
      if (color && color.before === item.before && color.after === item.after) return false;
    }
    return true;
  });
};

const isOwned = (key: string, target: string) =>
  key === target || key.startsWith(`${target}.`) || key.startsWith(`${target}::`);

const sameSize = (before?: string, after?: string) => {
  try {
    const [left, right] = [JSON.parse(before ?? '[]'), JSON.parse(after ?? '[]')] as number[][];
    return Math.abs(left[2] - right[2]) <= 0.05 && Math.abs(left[3] - right[3]) <= 0.05;
  } catch {
    return false;
  }
};

export const ownDifferences = (differences: StyleDifference[], targetKey: string) =>
  differences.filter(
    (item) =>
      isOwned(item.key, targetKey) &&
      !(item.property === 'box' && sameSize(item.before, item.after)),
  );

export type CaseStatus = 'difference' | 'equal' | 'error' | 'unstable';

export interface ComboDifference {
  combo: number;
  condition: string;
  differences: StyleDifference[];
  rootCauses: StyleDifference[];
}

export interface CaseResult {
  comboDifferences: ComboDifference[];
  differingConditions: string[];
  errors: string[];
  gaps: string[];
  key: string;
  rootCauses: StyleDifference[];
  status: CaseStatus;
  unstableConditions: string[];
}

const isSnapshot = (
  value: SectionSnapshot | undefined,
): value is StyleSnapshot & { targetKey?: string } => Boolean(value && !('error' in value));

const meaningful = (before: StyleSnapshot, after: StyleSnapshot) =>
  compareSnapshots(before, after).filter((item) => !item.diagnosticReason);

export const createRunAnalyzer = () => {
  const results = new Map<string, CaseResult>();
  const resultFor = (key: string) => {
    const existing = results.get(key);
    if (existing) return existing;
    const created: CaseResult = {
      comboDifferences: [],
      differingConditions: [],
      errors: [],
      gaps: [],
      key,
      rootCauses: [],
      status: 'equal',
      unstableConditions: [],
    };
    results.set(key, created);
    return created;
  };
  const add = (condition: ConditionCapture) => {
    for (const section of condition.identical ?? [])
      resultFor(section.slice(0, section.lastIndexOf('|')));
    for (const [section, base] of Object.entries(condition.base)) {
      const separator = section.lastIndexOf('|');
      const result = resultFor(section.slice(0, separator));
      const combo = Number(section.slice(separator + 1));
      const control = condition.baseAgain[section];
      const head = condition.head[section];
      if (!isSnapshot(base) || !isSnapshot(head)) {
        const message = !isSnapshot(base)
          ? `base:${base.error}`
          : `head:${head ? (head as { error: string }).error : 'missing'}`;
        if (!result.errors.includes(message)) result.errors.push(message);
        continue;
      }
      if (
        !isSnapshot(control) ||
        ownDifferences(meaningful(base, control), base.targetKey ?? 'root').length
      ) {
        if (!result.unstableConditions.includes(condition.condition))
          result.unstableConditions.push(condition.condition);
        continue;
      }
      const differences = ownDifferences(meaningful(base, head), base.targetKey ?? 'root');
      const causes = rootCausesOf(differences);
      if (!causes.length) continue;
      result.comboDifferences.push({
        combo,
        condition: condition.condition,
        differences,
        rootCauses: causes,
      });
      if (!result.differingConditions.includes(condition.condition))
        result.differingConditions.push(condition.condition);
      for (const cause of causes)
        if (
          !result.rootCauses.some(
            (item) =>
              item.key === cause.key &&
              item.property === cause.property &&
              item.before === cause.before &&
              item.after === cause.after,
          )
        )
          result.rootCauses.push(cause);
    }
  };
  const finish = (caseGaps: Record<string, string[]> = {}) => {
    for (const result of results.values()) {
      result.gaps = caseGaps[result.key] ?? [];
      result.status = result.errors.length
        ? 'error'
        : result.unstableConditions.length
          ? 'unstable'
          : result.differingConditions.length
            ? 'difference'
            : 'equal';
    }
    return [...results.values()];
  };
  return { add, finish };
};

export const analyzeRun = (capture: RunCapture): CaseResult[] => {
  const analyzer = createRunAnalyzer();
  capture.conditions.forEach(analyzer.add);
  return analyzer.finish(capture.caseGaps);
};

const statusOf = (result: CaseResult): CaseStatus =>
  result.errors.length
    ? 'error'
    : result.unstableConditions.length
      ? 'unstable'
      : result.differingConditions.length
        ? 'difference'
        : 'equal';

export const mergeRetry = (
  original: CaseResult,
  retry: CaseResult,
  conditions: string[] = original.unstableConditions,
): CaseResult => {
  const retried = new Set(conditions);
  const comboDifferences = [
    ...original.comboDifferences.filter((item) => !retried.has(item.condition)),
    ...retry.comboDifferences.filter((item) => retried.has(item.condition)),
  ];
  const rootCauses: CaseResult['rootCauses'] = [];
  for (const cause of comboDifferences.flatMap((item) => item.rootCauses))
    if (
      !rootCauses.some(
        (item) =>
          item.key === cause.key &&
          item.property === cause.property &&
          item.before === cause.before &&
          item.after === cause.after,
      )
    )
      rootCauses.push(cause);
  const merged: CaseResult = {
    ...original,
    comboDifferences,
    differingConditions: [
      ...new Set([
        ...original.differingConditions.filter((condition) => !retried.has(condition)),
        ...retry.differingConditions.filter((condition) => retried.has(condition)),
      ]),
    ],
    errors: [...new Set([...original.errors, ...retry.errors])],
    rootCauses,
    unstableConditions: [
      ...original.unstableConditions.filter((condition) => !retried.has(condition)),
      ...retry.unstableConditions.filter((condition) => retried.has(condition)),
    ],
  };
  merged.status = statusOf(merged);
  return merged;
};

export const DIFFERENCE_NOT_REPRODUCED = 'DIFFERENCE_NOT_REPRODUCED';

export const confirmDifferences = (
  original: CaseResult,
  retry: CaseResult,
  conditions: string[],
): CaseResult => {
  const merged = mergeRetry(original, retry, conditions);
  const dropped = conditions.some(
    (condition) =>
      original.differingConditions.includes(condition) &&
      !merged.differingConditions.includes(condition),
  );
  return dropped && !merged.gaps.includes(DIFFERENCE_NOT_REPRODUCED)
    ? { ...merged, gaps: [...merged.gaps, DIFFERENCE_NOT_REPRODUCED] }
    : merged;
};
