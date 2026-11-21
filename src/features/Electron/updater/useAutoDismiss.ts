import { useEffect, useRef, useState } from 'react';

/**
 * Calls `onDismiss` once `key` has stayed the same for `duration` ms.
 * A nullish `key` pauses the countdown; a new `key` restarts it.
 * Spread the returned handlers onto the toast so hovering pauses the countdown
 * and leaving restarts it in full.
 */
export const useAutoDismiss = (
  key: string | null | undefined,
  onDismiss: () => void,
  duration: number,
) => {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  // Track which key is hovered so a toast that unmounts under the pointer
  // (no mouseleave) does not leave the next one paused forever
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const paused = !!key && hoveredKey === key;

  useEffect(() => {
    if (key === null || key === undefined || paused) return;
    const timer = setTimeout(() => onDismissRef.current(), duration);
    return () => clearTimeout(timer);
  }, [key, duration, paused]);

  return {
    onMouseEnter: () => setHoveredKey(key ?? null),
    onMouseLeave: () => setHoveredKey(null),
  };
};
