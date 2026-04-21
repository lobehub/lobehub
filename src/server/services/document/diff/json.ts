import { create, type Delta, patch as patchDelta } from 'jsondiffpatch';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const createHashComparable = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(createHashComparable);
  }

  if (!isRecord(value)) return value;

  const comparable: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    if (key === 'id' || key === 'text') continue;

    comparable[key] = createHashComparable(value[key]);
  }

  return comparable;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const diffPatcher = create({
  arrays: {
    detectMove: false,
    includeValueOnMove: false,
  },
  cloneDiffValues: (value) => structuredClone(value),
  objectHash: (item) => stableStringify(createHashComparable(item)),
});

export type JsonPatchDelta = Exclude<Delta, undefined>;

export const createJsonPatch = (base: Record<string, any>, current: Record<string, any>) => {
  return diffPatcher.diff(base, current);
};

export const applyJsonPatch = (
  base: Record<string, any>,
  patch: JsonPatchDelta,
): Record<string, any> => {
  return patchDelta(structuredClone(base), patch) as Record<string, any>;
};

export const isOversizedJsonPatch = (
  patch: JsonPatchDelta,
  snapshot: Record<string, any>,
  threshold: number,
) => {
  return JSON.stringify(patch).length > JSON.stringify(snapshot).length * threshold;
};
