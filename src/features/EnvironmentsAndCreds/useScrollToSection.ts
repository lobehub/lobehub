'use client';

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/** How long the section keeps realigning while what sits above it loads. */
const SETTLE_MS = 2000;

/**
 * Scroll the element to the top of its scroll container when the URL hash
 * names it. Settings pages render inside their own scroll container, so the
 * browser's native anchor jump does not apply to client-side navigation.
 *
 * Lists above the section load on their own, pushing it down after the first
 * jump; for a short while it realigns whenever its position changes, and stops
 * as soon as the reader scrolls or presses a key.
 */
export const useScrollToSection = <T extends HTMLElement>(id: string) => {
  const ref = useRef<T>(null);
  const { hash } = useLocation();

  useEffect(() => {
    const element = ref.current;
    if (hash !== `#${id}` || !element) return;

    const align = () => element.scrollIntoView({ block: 'start' });
    align();

    let lastTop = element.getBoundingClientRect().top;
    const observer = new ResizeObserver(() => {
      const top = element.getBoundingClientRect().top;
      if (top === lastTop) return;
      align();
      lastTop = element.getBoundingClientRect().top;
    });
    if (element.parentElement) observer.observe(element.parentElement);

    const stop = () => observer.disconnect();
    const timer = setTimeout(stop, SETTLE_MS);
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchmove', stop, { once: true, passive: true });
    window.addEventListener('keydown', stop, { once: true });

    return () => {
      clearTimeout(timer);
      stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [hash, id]);

  return ref;
};
