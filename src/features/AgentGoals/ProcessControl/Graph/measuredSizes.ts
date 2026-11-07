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

/** Card node types: their height follows content, so a relayout hands the measurement back. */
const CARD_NODE_TYPES = new Set(['goalNode', 'goalExperiment']);

/**
 * Size fields for one flow node on a relayout. A relayout hands React Flow a
 * new node object, which it treats as unmeasured: it pins the card to
 * `initialHeight` and drops the handle positions its edges are drawn from.
 * Handing a card its last measurement back keeps both, so only a card that has
 * never rendered — or a framed container sized by the layout — gets the estimate.
 */
export const flowNodeSize = (
  type: string,
  measured: MeasuredSize | undefined,
  estimatedHeight: number | undefined,
): { initialHeight?: number; measured?: MeasuredSize } =>
  CARD_NODE_TYPES.has(type) && measured ? { measured } : { initialHeight: estimatedHeight };
