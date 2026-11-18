import { useCallback, useMemo, useState } from 'react';

export interface StepWindow<T> {
  /** Steps above the loaded ones. */
  hiddenCount: number;
  /** Load up to `loadMoreCount` more steps above the loaded ones. */
  showEarlier: () => void;
  visible: T[];
}

/**
 * Index of the first loaded step. `start` is anchored to the list's head, so
 * steps that stream in later append to the loaded range instead of pushing the
 * oldest loaded step out. It only moves down when the list shrinks below it,
 * and then still leaves the last `initialCount` steps loaded.
 */
export const clampWindowStart = (start: number, total: number, initialCount: number) =>
  Math.max(0, Math.min(start, total - initialCount));

/**
 * Render only the tail of a long step list and grow it upward on demand.
 * The window resets whenever the owner unmounts (e.g. the workflow folds).
 */
export const useStepWindow = <T>(
  items: T[],
  initialCount: number,
  loadMoreCount: number,
): StepWindow<T> => {
  const [start, setStart] = useState(() => Math.max(0, items.length - initialCount));
  const effectiveStart = clampWindowStart(start, items.length, initialCount);

  const showEarlier = useCallback(
    () => setStart(Math.max(0, effectiveStart - loadMoreCount)),
    [effectiveStart, loadMoreCount],
  );

  const visible = useMemo(
    () => (effectiveStart === 0 ? items : items.slice(effectiveStart)),
    [effectiveStart, items],
  );

  return { hiddenCount: effectiveStart, showEarlier, visible };
};
