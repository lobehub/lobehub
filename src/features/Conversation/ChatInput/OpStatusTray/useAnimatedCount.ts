import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

const COUNT_DURATION_S = 0.8;

/**
 * Formatted text that counts from the previously shown number to `value`
 * instead of jumping, so a growing total (tokens arrive in per-step chunks)
 * reads as growth. Starts at `value` on mount; reduced-motion users get the
 * plain jump. `format` must be stable.
 */
export const useAnimatedCount = (value: number, format: (value: number) => string): string => {
  const reduceMotion = useReducedMotion();
  const shownRef = useRef(value);
  const [display, setDisplay] = useState(() => format(value));

  useEffect(() => {
    const from = shownRef.current;
    if (from === value || reduceMotion) {
      shownRef.current = value;
      setDisplay(format(value));
      return;
    }

    const controls = animate(from, value, {
      duration: COUNT_DURATION_S,
      ease: 'easeOut',
      onUpdate: (latest) => {
        shownRef.current = latest;
        setDisplay(format(Math.round(latest)));
      },
    });
    return () => controls.stop();
  }, [format, reduceMotion, value]);

  return display;
};
