import { useCallback, useMemo, useState } from 'react';

export interface ArmOnInteraction {
  armed: boolean;
  /** Spread on the row's wrapper; empty once armed so later events cost nothing. */
  armProps: { onFocus?: () => void; onPointerEnter?: () => void };
}

/**
 * Flips to `armed` the first time the user points at or focuses the element,
 * and stays armed. Lets a row defer hover-only UI (its action buttons) until
 * someone could actually see it: a list of hundreds of rows otherwise mounts
 * all of it up front. Focus covers keyboard users tabbing into the row.
 */
export const useArmOnInteraction = (): ArmOnInteraction => {
  const [armed, setArmed] = useState(false);
  const arm = useCallback(() => setArmed(true), []);
  const armProps = useMemo(
    () => (armed ? {} : { onFocus: arm, onPointerEnter: arm }),
    [arm, armed],
  );

  return { armProps, armed };
};
