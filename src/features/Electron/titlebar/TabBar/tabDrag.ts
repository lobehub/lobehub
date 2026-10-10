import { layoutStrip, type StripTab } from './tabLayout';

// Switching between the pinned and flowing runs reflows the whole strip (the divider
// appears or moves, the tab morphs between pill and full width), so a pointer resting on
// the divider must not flip the tab back and forth on every move.
const GROUP_SWITCH_PENALTY = 12;
const RUBBER_BAND_FACTOR = 0.55;
const RUBBER_BAND_LIMIT = 40;

export interface DropTargetInput {
  activeId: string | null;
  draggedId: string;
  /** Where along the dragged tab the pointer holds it, as a fraction of its width. */
  grabFraction: number;
  /** Pointer x relative to the strip's origin. */
  pointerX: number;
  stripWidth: number;
  /** Current order, with the dragged tab wherever the last preview put it. */
  tabs: StripTab[];
}

/**
 * Every slot of both runs is a candidate; the one whose centre is nearest the dragged tab's
 * centre wins. The dragged tab's centre is measured at the candidate's own width, so a tab
 * crossing into the pinned run is judged as the pill it would become, held at the same spot.
 * Ties keep the earliest slot, which stops a tab dragged past the visible end from being
 * filed behind the tabs hidden in the overflow menu.
 */
export const resolveDropTarget = ({
  activeId,
  draggedId,
  grabFraction,
  pointerX,
  stripWidth,
  tabs,
}: DropTargetInput): StripTab[] => {
  const dragged = tabs.find((tab) => tab.id === draggedId);
  if (!dragged) return tabs;

  const others = tabs.filter((tab) => tab.id !== draggedId);
  let best = tabs;
  let bestDistance = Infinity;

  for (const pinned of [true, false]) {
    const run = others.filter((tab) => tab.pinned === pinned);
    const rest = others.filter((tab) => tab.pinned !== pinned);

    for (let slot = 0; slot <= run.length; slot += 1) {
      const candidateRun = [...run.slice(0, slot), { id: draggedId, pinned }, ...run.slice(slot)];
      const candidate = pinned ? [...candidateRun, ...rest] : [...rest, ...candidateRun];
      const placement = layoutStrip({ activeId, stripWidth, tabs: candidate }).placements.find(
        (item) => item.id === draggedId,
      );
      if (!placement) continue;

      const draggedCentre = pointerX + (0.5 - grabFraction) * placement.width;
      const distance =
        Math.abs(placement.x + placement.width / 2 - draggedCentre) +
        (pinned === dragged.pinned ? 0 : GROUP_SWITCH_PENALTY);

      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }

  return best;
};

const dampen = (overshoot: number): number =>
  (1 - 1 / ((overshoot * RUBBER_BAND_FACTOR) / RUBBER_BAND_LIMIT + 1)) * RUBBER_BAND_LIMIT;

export const rubberBand = (value: number, min: number, max: number): number => {
  if (value < min) return min - dampen(min - value);
  if (value > max) return max + dampen(value - max);
  return value;
};
