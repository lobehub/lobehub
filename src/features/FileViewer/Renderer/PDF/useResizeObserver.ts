import { useEffect } from 'react';

/**
 * Observes a given element using ResizeObserver.
 *
 * @param {Element} [element] Element to attach ResizeObserver to
 * @param {ResizeObserverOptions} [options] ResizeObserver options. WARNING! If you define the
 *   object in component body, make sure to memoize it.
 * @param {ResizeObserverCallback} observerCallback ResizeObserver callback. WARNING! If you define
 *   the function in component body, make sure to memoize it.
 * @returns {void}
 */
export default function useResizeObserver(
  element: Element | null,
   
  observerCallback: ResizeObserverCallback,
   
  options?: ResizeObserverOptions,
): void {
  useEffect(() => {
    if (!element || !('ResizeObserver' in window)) {
      return undefined;
    }

    const observer = new ResizeObserver(observerCallback);

    observer.observe(element, options);

    return () => {
      observer.disconnect();
    };
  }, [element, observerCallback, options]);
}
