import { useLayoutEffect, useState } from 'react';

import { acquireHintClock, HINT_DELAY, releaseHintClock } from './hintClock';

/**
 * `enter` once the wait outlasts `HINT_DELAY`; `static` when taking over a wait
 * whose caption is already on screen, so the handoff doesn't replay the
 * slide-in.
 */
export type LoadingHintState = 'enter' | 'static';

export const useLoadingHint = (): LoadingHintState | undefined => {
  const [hint, setHint] = useState<LoadingHintState>();

  // Layout effect: the previous instance releases the clock in the same commit,
  // and an already-due caption must be in place before this one paints.
  useLayoutEffect(() => {
    const remaining = acquireHintClock() + HINT_DELAY - performance.now();
    if (remaining <= 0) setHint('static');

    const timer = remaining > 0 ? setTimeout(() => setHint('enter'), remaining) : undefined;

    return () => {
      clearTimeout(timer);
      releaseHintClock();
    };
  }, []);

  return hint;
};
