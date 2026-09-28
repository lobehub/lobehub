import type { NodeChange } from '@xyflow/react';

export interface MeasuredSize {
  height: number;
  width: number;
}

export type MeasuredSizes = Readonly<Record<string, MeasuredSize>>;

/**
 * Fold React Flow's `dimensions` changes into the sizes the map lays out on.
 *
 * The sizes live in component state rather than being read back from React
 * Flow's node lookup: every relayout hands React Flow new node objects, which
 * it treats as unmeasured and clears. A layout driven by that lookup kept
 * losing the heights it had just laid out on and fell back to the estimate.
 *
 * Returns `previous` itself when nothing changed, so an unchanged measurement
 * does not trigger another layout pass.
 */
export const mergeMeasuredSizes = (
  previous: MeasuredSizes,
  changes: readonly NodeChange[],
): MeasuredSizes => {
  let next: Record<string, MeasuredSize> | undefined;
  for (const change of changes) {
    if (change.type !== 'dimensions' || !change.dimensions) continue;
    const width = Math.ceil(change.dimensions.width);
    const height = Math.ceil(change.dimensions.height);
    if (!width || !height) continue;
    const current = (next ?? previous)[change.id];
    if (current?.width === width && current.height === height) continue;
    next ??= { ...previous };
    next[change.id] = { height, width };
  }
  return next ?? previous;
};
