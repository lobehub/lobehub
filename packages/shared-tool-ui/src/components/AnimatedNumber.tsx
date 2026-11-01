'use client';

import { memo, useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  /**
   * Animation duration in ms.
   * @default 500
   */
  duration?: number;
  /**
   * Render the in-flight (possibly fractional) value. Without it the value is
   * rounded and rendered via `toLocaleString`.
   */
  formatter?: (value: number) => string;
  value: number;
}

/**
 * Counts the displayed number up (or down) to `value` whenever it changes,
 * using `requestAnimationFrame` + easeOutCubic. The first mount snaps to the
 * initial value (no count-up from zero), so only subsequent updates animate —
 * e.g. token totals ticking up while a subagent streams.
 */
export const AnimatedNumber = memo<AnimatedNumberProps>(({ value, duration = 500, formatter }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const frameRef = useRef<number>(undefined);
  const startTimeRef = useRef<number>(undefined);
  const startValueRef = useRef(value);

  useEffect(() => {
    const startValue = startValueRef.current;
    const diff = value - startValue;

    if (diff === 0) return;

    const animate = (currentTime: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // easeOutCubic
      const easeProgress = 1 - (1 - progress) ** 3;
      const current = startValue + diff * easeProgress;

      setDisplayValue(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        startValueRef.current = value;
        startTimeRef.current = undefined;
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [value, duration]);

  return formatter ? formatter(displayValue) : Math.round(displayValue).toLocaleString();
});

AnimatedNumber.displayName = 'AnimatedNumber';
