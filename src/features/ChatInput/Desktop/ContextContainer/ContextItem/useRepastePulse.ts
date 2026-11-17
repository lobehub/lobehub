import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { type RefObject, useEffect, useRef } from 'react';

const PULSE_MS = 480;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Pulses an image card when the same image is pasted again. The duplicate adds no card, so
 * without this the paste looks like it failed. Only a change after mount pulses: a draft
 * restored with an old `repastedAt` stays still. Under reduced motion only the border lights up.
 */
export const useRepastePulse = (
  ref: RefObject<HTMLElement | null>,
  repastedAt: number | undefined,
) => {
  const mountedWith = useRef(repastedAt);

  useEffect(() => {
    const element = ref.current;
    if (!element || repastedAt === undefined || repastedAt === mountedWith.current) return;
    mountedWith.current = undefined;

    const highlight = { borderColor: cssVar.colorPrimary };
    const keyframes: Keyframe[] = prefersReducedMotion()
      ? [{}, { ...highlight, offset: 0.3 }, {}]
      : [{}, { ...highlight, offset: 0.3, transform: 'scale(1.04)' }, {}];
    const animation = element.animate?.(keyframes, { duration: PULSE_MS, easing: 'ease-out' });

    return () => animation?.cancel();
  }, [ref, repastedAt]);
};
