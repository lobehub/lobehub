import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';

/** Reading speed of the reveal, in pixels per second. */
const SCROLL_SPEED = 35;
/** Pause before the title starts moving, and hold at its tail, in milliseconds. */
const START_DELAY = 600;
const END_HOLD = 1200;
/** Width of the edge fade the text dissolves under while it slides. */
export const TITLE_MARQUEE_FADE = 16;

/** Width of the fade `NavItem` lays over its content just before the action overlay. */
export const NAV_ITEM_CONTENT_FADE = 28;

export const TITLE_MARQUEE_FADE_START_VAR = '--nav-title-marquee-fade-start';
export const TITLE_MARQUEE_FADE_END_VAR = '--nav-title-marquee-fade-end';
/** Set by `NavItem`: the width its hover action overlay covers. */
export const NAV_ITEM_ACTIONS_INSET_VAR = '--nav-item-actions-inset';

export interface TitleMarqueeTimeline {
  /** Total animation duration in milliseconds. */
  duration: number;
  /** Offset where the left edge fade reaches full width. */
  fadeIn: number;
  /** Offset where the right edge fade starts clearing. */
  fadeOut: number;
  /** Offset where the text reaches its tail. */
  slideEnd: number;
  /** Offset where the text starts sliding. */
  slideStart: number;
}

/**
 * Keyframe offsets for revealing a title clipped by `distance` pixels behind an
 * edge fade of `fade` pixels. `Element.animate` throws when offsets decrease,
 * and when the ramp is half the travel the two sides of `fadeIn <= fadeOut` are
 * equal in exact arithmetic but can round apart, so each offset is clamped to
 * the previous one.
 */
export const getTitleMarqueeTimeline = (distance: number, fade: number): TitleMarqueeTimeline => {
  const travel = (distance / SCROLL_SPEED) * 1000;
  const duration = START_DELAY + travel + END_HOLD;
  const ramp = (Math.min(Math.max(fade, 0), distance / 2) / SCROLL_SPEED) * 1000;
  const slideStart = START_DELAY / duration;
  const fadeIn = Math.max(slideStart, (START_DELAY + ramp) / duration);
  const fadeOut = Math.max(fadeIn, (START_DELAY + travel - ramp) / duration);
  const slideEnd = Math.min(1, Math.max(fadeOut, (START_DELAY + travel) / duration));
  return { duration, fadeIn, fadeOut, slideEnd, slideStart };
};

let fadePropertiesRegistered = false;

/**
 * Registered so the edge widths interpolate inside `Element.animate`; an
 * unregistered custom property would jump between keyframes instead.
 */
const registerFadeProperties = () => {
  if (fadePropertiesRegistered) return;
  fadePropertiesRegistered = true;
  if (typeof CSS === 'undefined' || typeof CSS.registerProperty !== 'function') return;
  for (const name of [TITLE_MARQUEE_FADE_START_VAR, TITLE_MARQUEE_FADE_END_VAR]) {
    try {
      CSS.registerProperty({ inherits: false, initialValue: '0px', name, syntax: '<length>' });
    } catch {
      // Already registered (e.g. after HMR re-evaluated this module).
    }
  }
};

/**
 * Right edge the title text stays readable up to. On hover the NavItem fades
 * its content out under the action overlay (see `NavItem` styles); the tail
 * has to stop where that fade begins, or the last characters slide out of
 * sight right as they are revealed.
 */
const getReadableRight = (viewport: HTMLElement, container: HTMLElement | null) => {
  const viewportRight = viewport.getBoundingClientRect().right;
  const content = viewport.closest<HTMLElement>('[data-nav-item-content]');
  if (!content || !container) return viewportRight;
  const inset = Number.parseFloat(
    getComputedStyle(container).getPropertyValue(NAV_ITEM_ACTIONS_INSET_VAR),
  );
  if (!Number.isFinite(inset)) return viewportRight;
  const contentFadeStart = content.getBoundingClientRect().right - inset - NAV_ITEM_CONTENT_FADE;
  return Math.min(viewportRight, contentFadeStart);
};

/**
 * Whether the marquee can replace the title tooltip here. The slide, the
 * readable-edge math and the edge fades are left-to-right, and under reduced
 * motion there is no slide to reveal the title; both keep the tooltip.
 *
 * Direction is read from the document, which the locale setup flips on a
 * language change: it is the direction the layout actually uses.
 */
export const useTitleMarqueeAvailable = () => {
  const reduceMotion = useReducedMotion();
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  return !reduceMotion && !rtl;
};

/**
 * Slides an overflowing title to its tail while the row is hovered, at a
 * constant reading speed, instead of showing the full title in a tooltip.
 * The edge fades animate with it: the left edge fades in as text slides under
 * it and the right edge clears once the tail is revealed. At rest the title
 * only carries the right-edge fade (`NavItem` styles), no ellipsis.
 * Titles that fit never move. Observers and animations exist only while the
 * row is hovered, so an idle list installs nothing per row.
 */
export const useTitleMarquee = (enabled: boolean, titleKey: unknown) => {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (!enabled || stopRef.current) return;
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text || typeof text.animate !== 'function') return;

    registerFadeProperties();
    const container = viewport.closest<HTMLElement>('[data-nav-item]');
    let animations: Animation[] = [];

    const reset = () => {
      for (const animation of animations) animation.cancel();
      animations = [];
    };

    const reveal = () => {
      reset();
      const readableWidth =
        getReadableRight(viewport, container) - viewport.getBoundingClientRect().left;
      const distance = Math.ceil(text.scrollWidth - readableWidth);
      if (distance <= 1) return;

      const fade = `${TITLE_MARQUEE_FADE}px`;
      const { duration, fadeIn, fadeOut, slideEnd, slideStart } = getTitleMarqueeTimeline(
        distance,
        TITLE_MARQUEE_FADE,
      );
      const timing: KeyframeAnimationOptions = { duration, easing: 'linear', fill: 'forwards' };
      const shifted = `translateX(-${distance}px)`;

      animations.push(
        text.animate(
          [
            { offset: 0, transform: 'translateX(0)' },
            { offset: slideStart, transform: 'translateX(0)' },
            { offset: slideEnd, transform: shifted },
            { offset: 1, transform: shifted },
          ],
          timing,
        ),
      );

      const edges = (startWidth: string, endWidth: string, offset: number): Keyframe => ({
        [TITLE_MARQUEE_FADE_END_VAR]: endWidth,
        [TITLE_MARQUEE_FADE_START_VAR]: startWidth,
        offset,
      });
      animations.push(
        viewport.animate(
          [
            edges('0px', fade, 0),
            edges('0px', fade, slideStart),
            edges(fade, fade, fadeIn),
            edges(fade, fade, fadeOut),
            edges(fade, '0px', slideEnd),
            edges(fade, '0px', 1),
          ],
          timing,
        ),
      );
    };

    // Observing keeps sidebar resizing and font loading accurate while hovered.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reveal);
    // Wait a frame: the hover mounts the row's lazy actions, which can widen
    // the action overlay the readable width is measured against.
    let frame: number | undefined;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      reveal();
      observer?.observe(viewport);
      observer?.observe(text);
    });

    stopRef.current = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      reset();
    };
  }, [enabled]);

  // A title renamed (or generated) mid-hover restarts from its head.
  useEffect(() => {
    if (!stopRef.current) return;
    stop();
    start();
  }, [titleKey, start, stop]);

  useEffect(() => stop, [stop]);

  return { start, stop, textRef, viewportRef };
};
