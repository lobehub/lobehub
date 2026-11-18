import { type RefObject, useLayoutEffect, useRef } from 'react';

/** Growing uses a decelerating curve; shrinking is quicker and accelerates out. */
const EXPAND = { duration: '200ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const COLLAPSE = { duration: '160ms', easing: 'cubic-bezier(0.3, 0, 1, 1)' };

/**
 * How long after mounting content changes apply at once. A composer remounted with a draft
 * restores its attachments a few frames after mount; they were already there for the user.
 */
const MOUNT_SETTLE_MS = 500;
/**
 * How long after a content change height changes animate. One change resizes several times:
 * a removed card first shrinks while it exits, then the row collapses once it is gone.
 */
const CHANGE_WINDOW_MS = 600;

/**
 * Decides which height changes animate: those shortly after the content changed, except
 * right after mount. Times are `performance.now()` milliseconds.
 */
export const createHeightMotionGate = (mountedAt: number) => {
  let animateUntil = 0;
  return {
    contentChanged: (now: number) => {
      animateUntil = now - mountedAt < MOUNT_SETTLE_MS ? 0 : now + CHANGE_WINDOW_MS;
    },
    shouldAnimate: (now: number) => now < animateUntil,
  };
};

/**
 * Makes an outer element's height follow its content with a CSS transition instead of
 * jumping, so the composer grows when the first attachment arrives and shrinks when the last
 * one leaves. The outer element needs `overflow: hidden` and a `height` transition.
 *
 * The content is measured with a `ResizeObserver`, which runs after layout and before
 * paint, so content that just grew is clipped by the old height for that frame instead of
 * showing at full size first.
 *
 * Only height changes shortly after `contentKey` (the attachments themselves) changes
 * animate. Others apply at once: a window resize that wraps the cards onto another row is not
 * something the user just did to them.
 */
export const useContentHeightTransition = <Outer extends HTMLElement, Inner extends HTMLElement>(
  contentKey: unknown,
): readonly [RefObject<Outer | null>, RefObject<Inner | null>] => {
  const outerRef = useRef<Outer>(null);
  const innerRef = useRef<Inner>(null);
  const gate = useRef<ReturnType<typeof createHeightMotionGate>>(null);

  useLayoutEffect(() => {
    gate.current = createHeightMotionGate(performance.now());
  }, []);

  const previousKey = useRef(contentKey);
  useLayoutEffect(() => {
    if (Object.is(previousKey.current, contentKey)) return;
    previousKey.current = contentKey;
    gate.current?.contentChanged(performance.now());
  }, [contentKey]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let height = inner.offsetHeight;
    outer.style.height = `${height}px`;

    const observer = new ResizeObserver(() => {
      const next = inner.offsetHeight;
      if (next === height) return;
      const animate = !!gate.current?.shouldAnimate(performance.now());
      const motion = next > height ? EXPAND : COLLAPSE;
      outer.style.transitionDuration = animate ? motion.duration : '0s';
      outer.style.transitionTimingFunction = motion.easing;
      outer.style.height = `${next}px`;
      height = next;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return [outerRef, innerRef] as const;
};
