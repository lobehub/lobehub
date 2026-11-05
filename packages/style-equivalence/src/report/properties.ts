import type { CaseSnapshot } from './api';

export type PropertyMode = 'all' | 'declared' | 'diff';

export interface PropertyRow {
  base?: string;
  head?: string;
  mark: 'different' | 'ignored' | 'same';
  name: string;
  reason?: string;
}

export const propertyRows = (
  snapshot: CaseSnapshot,
  declared: string[],
  mode: PropertyMode,
): PropertyRow[] => {
  const targetKey = snapshot.base.targetKey;
  const differing = new Set(
    snapshot.differences.filter((item) => item.key === targetKey).map((item) => item.property),
  );
  const ignored = new Map(
    snapshot.ignored
      .filter((item) => item.key === targetKey)
      .map((item) => [item.property, item.reason]),
  );
  const baseValues = snapshot.base.target?.values ?? {};
  const headValues = snapshot.head.target?.values ?? {};
  const names =
    mode === 'all'
      ? [...new Set([...Object.keys(baseValues), ...Object.keys(headValues)])].sort()
      : mode === 'diff'
        ? [...differing].sort()
        : declared.filter((name) => name in baseValues || name in headValues);
  return names.map((name) => {
    const reason = ignored.get(name);
    return {
      base: baseValues[name],
      head: headValues[name],
      mark: differing.has(name) ? 'different' : reason ? 'ignored' : 'same',
      name,
      ...(reason && !differing.has(name) ? { reason } : {}),
    };
  });
};
